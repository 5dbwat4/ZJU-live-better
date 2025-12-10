import crypto from "crypto";
import { AutoSignCore, defaultRaderInfo } from "./autosign-core.js";
import { Scheduler, _testHelpers as SchedulerHelpers } from "./scheduler.js";
import { UserLogger } from "./logger.js";
import { loginAndGetCookie, testCookieValid } from "./auth-helper.js";

const IS_DEBUG = String(process.env.DEBUG || "").toLowerCase() === "true";

function nowISO() {
  return new Date().toISOString();
}

const VALID_RADER_AT = new Set([
  "ZJGD1",
  "ZJGX1",
  "ZJGB1",
  "YQ4",
  "YQ1",
  "YQ7",
  "ZJ1",
  "HJC1",
  "HJC2",
  "ZJ2",
  "YQSS",
  "ZJG4",
]);

function ensureValidUsername(username, required = false) {
  if (!username && !required) return;
  if (!username || !/^\d{10}$/.test(username)) {
    throw new Error("用户名格式无效，需为 10 位数字学号");
  }
}

function ensureValidRaderAt(raderAt) {
  if (!raderAt) return;
  if (!VALID_RADER_AT.has(raderAt)) {
    throw new Error("raderAt 无效，必须为预设位置之一");
  }
}

/**
 * 认证模式：
 * - PASSWORD: 省心模式，保存加密密码，可自动续期
 * - SECURE: 极致安全模式，密码换 Cookie 后立即销毁密码，仅保存 Cookie
 */
const AUTH_MODE = {
  PASSWORD: "password_persist",
  SECURE: "secure_cookie",  // 新模式：密码换 Cookie
};

const NOTIFY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

function isNowInUserWindow(entry) {
  const { isNowInWindow } = SchedulerHelpers || {};
  if (!isNowInWindow || !entry?.scheduler) return true;
  return isNowInWindow(entry.scheduler.startTime, entry.scheduler.endTime);
}

export class UserManager {
  constructor({ store, dingTalk, controlNotify }) {
    this.store = store;
    this.dingTalk = dingTalk;
    this.controlNotify = controlNotify;
    this.userMap = new Map(); // id -> { config, core, scheduler, logger }
  }

  async init() {
    const users = await this.store.loadUsers();
    // 补齐缺省字段，确保兼容旧数据
    let needSave = false;
    for (const u of users) {
      if (!u.authMode) {
        u.authMode = AUTH_MODE.PASSWORD;
        needSave = true;
      }
      if (typeof u.authExpired !== "boolean") {
        u.authExpired = false;
        needSave = true;
      }
      if (typeof u.lastAuthFailAt === "undefined") {
        u.lastAuthFailAt = null;
        needSave = true;
      }
      if (typeof u.lastNotifyAt === "undefined") {
        u.lastNotifyAt = null;
        needSave = true;
      }
    }
    if (needSave) {
      await this.store.saveUsers(users);
    }
    for (const user of users) {
      await this._ensureUserInstance(user, false);
    }
  }

  listUsers() {
    return Array.from(this.userMap.values()).map(({ config, core, scheduler }) => ({
      ...this._publicUser(config),
      running: core?.running || false,
      schedulerEnabled: scheduler?.enableSchedule || false,
    }));
  }

  validateUserToken(userToken) {
    const entry = Array.from(this.userMap.values()).find(
      (v) => v.config.userToken === userToken
    );
    if (!entry) return null;
    return entry.config;
  }

  async upsertUser(data) {
    const users = await this.store.loadUsers();
    let target = users.find((u) => u.id === data.id);
    const now = nowISO();
    if (!target) {
      ensureValidUsername(data.username, true);
      target = {
        id: data.id || crypto.randomUUID(),
        createdAt: now,
      };
      users.push(target);
    }
    ensureValidUsername(data.username);
    if (data.username) {
      target.username = data.username;
    }
    // 认证模式与凭证处理
    target.authMode = data.authMode || target.authMode || AUTH_MODE.PASSWORD;
    if (data.password) {
      target.passwordEnc = this.store.encryptPassword(data.password);
      target.authExpired = false;
    }
    if (data.cookie) {
      target.cookieEnc = this.store.encryptCookie(data.cookie);
      target.authExpired = false;
    }
    if (!target.authMode) target.authMode = AUTH_MODE.PASSWORD;
    if (typeof target.authExpired !== "boolean") target.authExpired = false;
    if (typeof target.lastAuthFailAt === "undefined") target.lastAuthFailAt = null;
    if (typeof target.lastNotifyAt === "undefined") target.lastNotifyAt = null;
    ensureValidRaderAt(data.raderAt ?? target.raderAt);
    target.raderAt = data.raderAt ?? target.raderAt ?? "ZJGD1";
    target.coldDownTime = Number(data.coldDownTime ?? target.coldDownTime ?? 4000);
    target.enableSchedule = data.enableSchedule ?? target.enableSchedule ?? false;
    target.windowStart = data.windowStart ?? target.windowStart ?? "08:00";
    target.windowEnd = data.windowEnd ?? target.windowEnd ?? "22:00";
    target.logEmptyRollcall = data.logEmptyRollcall ?? target.logEmptyRollcall ?? false;
    target.enabled = data.enabled ?? target.enabled ?? true;
    target.userToken = target.userToken || this.store.newUserToken();
    target.updatedAt = now;

    await this.store.saveUsers(users);
    await this._ensureUserInstance(target, true);
    await this._notify(`[Control] 用户 ${target.username} 已更新/创建`);
    return this._publicUser(target);
  }

  async createViaInvite({ inviteCode, username, password, authMode }) {
    if (!inviteCode || !username || !password) {
      throw new Error("邀请码、用户名、密码不能为空");
    }
    ensureValidUsername(username, true);
    const users = await this.store.loadUsers();
    if (users.find((u) => u.username === username)) {
      throw new Error("用户名已存在");
    }
    
    const finalAuthMode = authMode || AUTH_MODE.PASSWORD;
    const now = nowISO();
    const id = crypto.randomUUID();
    const userToken = this.store.newUserToken();
    
    let passwordEnc = undefined;
    let cookieEnc = undefined;
    
    if (finalAuthMode === AUTH_MODE.SECURE) {
      // 极致安全模式：用密码登录获取 Cookie，然后销毁密码
      console.log(`[UserManager] 极致安全模式：为用户 ${username} 获取 Cookie...`);
      const result = await loginAndGetCookie(username, password);
      if (!result.ok) {
        throw new Error(result.error || "登录失败，无法获取 Cookie");
      }
      cookieEnc = this.store.encryptCookie(result.cookie);
      // 密码不保存！
      console.log(`[UserManager] 极致安全模式：Cookie 已获取并加密保存，密码已销毁`);
    } else {
      // 省心模式：保存加密密码
      passwordEnc = this.store.encryptPassword(password);
    }
    
    const config = {
      id,
      username,
      authMode: finalAuthMode,
      passwordEnc,
      cookieEnc,
      authExpired: false,
      lastAuthFailAt: null,
      lastNotifyAt: null,
      raderAt: "ZJGD1",
      coldDownTime: 4000,
      enableSchedule: false,
      windowStart: "08:00",
      windowEnd: "22:00",
      logEmptyRollcall: false,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      userToken,
    };
    
    // 验证并占用邀请码
    const ok = await this.store.useInvite(inviteCode, id);
    if (!ok) throw new Error("邀请码无效或已被使用");
    users.push(config);
    await this.store.saveUsers(users);
    await this._ensureUserInstance(config, true);
    await this._notify(`[Control] 新用户 ${username} 通过邀请码加入 (${finalAuthMode})`);
    return { user: this._publicUser(config), userToken };
  }

  async deleteUser(id) {
    const users = await this.store.loadUsers();
    const idx = users.findIndex((u) => u.id === id);
    if (idx === -1) return { ok: false, message: "not found" };
    const [removed] = users.splice(idx, 1);
    await this.store.saveUsers(users);
    await this.stopUser(id);
    this.userMap.delete(id);
    await this._notify(`[Control] 用户 ${removed.username} 已删除`);
    return { ok: true };
  }

  async startUser(id, options = {}) {
    const entry = this.userMap.get(id);
    if (!entry) return { ok: false, message: "not found" };
    
    const { forceOverride = false } = options;
    
    // 检查是否启用调度且当前在窗口外
    if (entry.config.enableSchedule && !forceOverride) {
      const inWindow = entry.scheduler.isCurrentlyInWindow();
      if (!inWindow) {
        await entry.logger.warn("[手动启动] 当前不在调度时间窗口内，需要用户确认");
        return { 
          ok: false, 
          needConfirm: true,
          message: "当前不在调度时间窗口内。确认启动后，将持续运行直到下次调度开始时间，届时恢复自动调度。" 
        };
      }
    }
    
    // 如果用户确认覆盖，暂停调度直到下次窗口开始
    if (forceOverride && entry.config.enableSchedule) {
      const inWindow = entry.scheduler.isCurrentlyInWindow();
      if (!inWindow) {
        entry.scheduler.pauseUntilNextWindowStart();
        await entry.logger.info("[手动启动] 用户确认覆盖调度，已暂停自动调度直到下次窗口开始");
      }
    }
    
    await entry.core.start();
    return { ok: true };
  }

  async stopUser(id, options = {}) {
    const entry = this.userMap.get(id);
    if (!entry) return { ok: false, message: "not found" };
    
    const { forceOverride = false } = options;
    
    // 检查是否启用调度且当前在窗口内
    if (entry.config.enableSchedule && !forceOverride) {
      const inWindow = entry.scheduler.isCurrentlyInWindow();
      if (inWindow) {
        await entry.logger.warn("[手动停止] 当前处于调度时间窗口内，需要用户确认");
        return { 
          ok: false, 
          needConfirm: true,
          message: "当前处于调度时间窗口内。确认停止后，今日内将不再自动启动，明日恢复正常调度。" 
        };
      }
    }
    
    // 如果用户确认覆盖，暂停调度直到明天
    if (forceOverride && entry.config.enableSchedule) {
      const inWindow = entry.scheduler.isCurrentlyInWindow();
      if (inWindow) {
        entry.scheduler.pauseUntilTomorrow();
        await entry.logger.info("[手动停止] 用户确认覆盖调度，已暂停自动调度直到明日");
      }
    }
    
    await entry.core.stop();
    return { ok: true };
  }

  async updateWindow(id, { startTime, endTime, enableSchedule }) {
    const entry = this.userMap.get(id);
    if (!entry) return { ok: false, message: "not found" };
    await entry.scheduler.updateWindow({ startTime, endTime, enableSchedule });
    return { ok: true, scheduler: entry.scheduler.getStatus() };
  }

  status(id) {
    const entry = this.userMap.get(id);
    if (!entry) return { ok: false, message: "not found" };
    return {
      ok: true,
      user: this._publicUser(entry.config),
      core: entry.core.getStatus(),
      scheduler: entry.scheduler.getStatus(),
    };
  }

  async statusByToken(userToken) {
    const config = this.validateUserToken(userToken);
    if (!config) return { ok: false, message: "not found" };
    const entry = this.userMap.get(config.id);
    const result = this.status(entry.config.id);
    // 为用户自己返回解密后的密码（仅当存在）
    if (result.ok && entry.config.passwordEnc) {
      try {
        result.user.password = this.store.decryptPassword(entry.config.passwordEnc);
      } catch (e) {
        result.user.password = "(解密失败)";
      }
    }
    return result;
  }

  async updateByToken(userToken, data) {
    const config = this.validateUserToken(userToken);
    if (!config) throw new Error("not found");
    const users = await this.store.loadUsers();
    const target = users.find((u) => u.id === config.id);
    if (!target) throw new Error("not found");
    const now = nowISO();
    if (data.username) {
      ensureValidUsername(data.username);
      target.username = data.username;
    }
    
    // 认证模式切换与凭证更新
    const newAuthMode = data.authMode || target.authMode || AUTH_MODE.PASSWORD;
    
    if (data.authMode && data.authMode !== AUTH_MODE.PASSWORD && data.authMode !== AUTH_MODE.SECURE) {
      throw new Error("authMode 无效，仅支持 password_persist 或 secure_cookie");
    }
    
    // 处理密码更新
    if (data.password) {
      if (newAuthMode === AUTH_MODE.SECURE) {
        // 极致安全模式：用密码获取 Cookie，然后销毁密码
        console.log(`[UserManager] 极致安全模式：为用户 ${target.username} 更新 Cookie...`);
        const result = await loginAndGetCookie(target.username, data.password);
        if (!result.ok) {
          throw new Error(result.error || "登录失败，无法获取 Cookie");
        }
        target.cookieEnc = this.store.encryptCookie(result.cookie);
        target.passwordEnc = undefined; // 确保不保存密码
        target.authExpired = false;
        console.log(`[UserManager] 极致安全模式：Cookie 已更新，密码已销毁`);
      } else {
        // 省心模式：保存加密密码
        target.passwordEnc = this.store.encryptPassword(data.password);
        target.authExpired = false;
      }
    }
    
    // 模式切换处理
    if (data.authMode && data.authMode !== target.authMode) {
      target.authMode = data.authMode;
      if (data.authMode === AUTH_MODE.SECURE) {
        // 切换到极致安全模式，必须提供密码来获取 Cookie
        if (!data.password) {
          throw new Error("切换到极致安全模式需要输入密码以获取 Cookie");
        }
        target.passwordEnc = undefined; // 删除已存储的密码
      } else if (data.authMode === AUTH_MODE.PASSWORD) {
        // 切换到省心模式，必须提供密码
        if (!data.password && !target.passwordEnc) {
          throw new Error("切换到省心模式需要输入密码");
        }
      }
    }
    
    if (!target.authMode) target.authMode = AUTH_MODE.PASSWORD;
    if (typeof target.authExpired !== "boolean") target.authExpired = false;
    if (typeof target.lastAuthFailAt === "undefined") target.lastAuthFailAt = null;
    if (typeof target.lastNotifyAt === "undefined") target.lastNotifyAt = null;
    if (data.raderAt) {
      ensureValidRaderAt(data.raderAt);
      target.raderAt = data.raderAt;
    }
    if (data.coldDownTime) target.coldDownTime = Number(data.coldDownTime);
    if (typeof data.enableSchedule === "boolean") target.enableSchedule = data.enableSchedule;
    if (data.windowStart) target.windowStart = data.windowStart;
    if (data.windowEnd) target.windowEnd = data.windowEnd;
    if (typeof data.logEmptyRollcall === "boolean") target.logEmptyRollcall = data.logEmptyRollcall;
    if (typeof data.enabled === "boolean") target.enabled = data.enabled;
    target.updatedAt = now;
    await this.store.saveUsers(users);
    await this._ensureUserInstance(target, true);
    return this._publicUser(target);
  }

  async startByToken(userToken, options = {}) {
    const config = this.validateUserToken(userToken);
    if (!config) return { ok: false, message: "not found" };
    return this.startUser(config.id, options);
  }

  async stopByToken(userToken, options = {}) {
    const config = this.validateUserToken(userToken);
    if (!config) return { ok: false, message: "not found" };
    return this.stopUser(config.id, options);
  }

  async updateWindowByToken(userToken, { startTime, endTime, enableSchedule }) {
    const config = this.validateUserToken(userToken);
    if (!config) return { ok: false, message: "not found" };
    return this.updateWindow(config.id, { startTime, endTime, enableSchedule });
  }

  _publicUser(config) {
    return {
      id: config.id,
      username: config.username,
      raderAt: config.raderAt,
      coldDownTime: config.coldDownTime,
      enableSchedule: config.enableSchedule,
      windowStart: config.windowStart,
      windowEnd: config.windowEnd,
      logEmptyRollcall: config.logEmptyRollcall,
      enabled: config.enabled,
      authMode: config.authMode || AUTH_MODE.PASSWORD,
      authExpired: !!config.authExpired,
      hasPassword: !!config.passwordEnc,
      hasCookie: !!config.cookieEnc,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
      userToken: config.userToken,
    };
  }

  async _ensureUserInstance(config, restart) {
    const existing = this.userMap.get(config.id);
    if (existing && !restart) return existing;
    if (existing && restart) {
      // 必须先停止旧的 scheduler 和 core，等待 runLoop 完全退出
      existing.scheduler.stop();
      await existing.core.stop();
    }
    const logger =
      existing?.logger ||
      new UserLogger({
        userId: config.id,
        username: config.username,
        dingTalk: this.dingTalk,
      });
    
    // 根据认证模式决定使用什么凭证
    const authMode = config.authMode || AUTH_MODE.PASSWORD;
    let passwordPlain = undefined;
    let cookiePlain = undefined;
    
    if (authMode === AUTH_MODE.SECURE) {
      // 极致安全模式：只使用 Cookie
      cookiePlain = config.cookieEnc ? this.store.decryptCookie(config.cookieEnc) : undefined;
      if (!cookiePlain) {
        await logger?.warn(`[Auto Sign-in] 极致安全模式但无有效 Cookie，请重新授权`);
        config.authExpired = true;
        await this._persistConfig(config);
        return;
      }
    } else {
      // 省心模式：使用密码
      passwordPlain = config.passwordEnc ? this.store.decryptPassword(config.passwordEnc) : undefined;
      if (!passwordPlain) {
        await logger?.warn(`[Auto Sign-in] 省心模式但无有效密码，请重新配置`);
        config.authExpired = true;
        await this._persistConfig(config);
        return;
      }
    }

    let core;
    try {
      core = new AutoSignCore({
        username: config.username,
        password: passwordPlain,
        cookie: cookiePlain,
        authMode: authMode,
        dingTalk: this.dingTalk,
        logger,
        raderAt: config.raderAt,
        coldDownTime: config.coldDownTime,
        raderInfo: defaultRaderInfo,
        userId: config.id,
        logEmptyRollcall: !!config.logEmptyRollcall,
        debug: IS_DEBUG,
        onAuthExpired: async (reason) => {
          await this._handleAuthExpired(config.id, reason);
        },
        onAuthRecovered: async () => {
          await this._handleAuthRecovered(config.id);
        },
      });
    } catch (e) {
      await logger?.error(`[Auto Sign-in] 无法初始化用户 ${config.username} 的核心任务: ${e.message}`);
      config.authExpired = true;
      await this._persistConfig(config);
      return;
    }
    const scheduler = new Scheduler(core, {
      startTime: config.windowStart,
      endTime: config.windowEnd,
      enableSchedule: config.enableSchedule,
    });
    scheduler.start();
    if (!config.enableSchedule && config.enabled) {
      await core.start();
    }
    this.userMap.set(config.id, { config, core, scheduler, logger });
    return this.userMap.get(config.id);
  }

  async _notify(msg) {
    if (this.controlNotify) {
      try {
        await this.controlNotify(msg);
      } catch (e) {
        console.error("[Control notify] failed:", e);
      }
    }
  }

  async _handleAuthExpired(id, reason = "") {
    const entry = this.userMap.get(id);
    if (!entry) return;
    const nowIso = nowISO();
    entry.config.authExpired = true;
    entry.config.lastAuthFailAt = nowIso;

    // 控制提醒频率
    const last = entry.config.lastNotifyAt ? new Date(entry.config.lastNotifyAt).getTime() : 0;
    const now = Date.now();
    const shouldNotify = !last || now - last > NOTIFY_INTERVAL_MS;

    if (shouldNotify) {
      entry.config.lastNotifyAt = nowIso;
      const msg =
        `[Auto Sign-in] 用户 ${entry.config.username} 登录授权已失效，请在网页重新授权。` +
        (reason ? ` 原因: ${reason}` : "");
      try {
        await entry.logger.warn(msg);
      } catch (e) {
        console.error("notify auth expired failed:", e);
      }
    }

    await this._persistConfig(entry.config);
  }

  async _handleAuthRecovered(id) {
    const entry = this.userMap.get(id);
    if (!entry) return;
    entry.config.authExpired = false;
    entry.config.lastAuthFailAt = null;
    // 不强制清空 lastNotifyAt，保留记录
    await this._persistConfig(entry.config);
  }

  async _persistConfig(config) {
    const users = await this.store.loadUsers();
    const idx = users.findIndex((u) => u.id === config.id);
    if (idx === -1) return;
    users[idx] = { ...users[idx], ...config };
    await this.store.saveUsers(users);
  }

  async logs(id) {
    const entry = this.userMap.get(id);
    if (!entry) return { ok: false, message: "not found" };
    const logs = await entry.logger.getRecent();
    return { ok: true, logs };
  }

  async logsByToken(userToken) {
    const config = this.validateUserToken(userToken);
    if (!config) return { ok: false, message: "not found" };
    return this.logs(config.id);
  }

  async clearLogs(id) {
    const entry = this.userMap.get(id);
    if (!entry) return { ok: false, message: "not found" };
    await entry.logger.clear();
    return { ok: true };
  }

  async clearLogsByToken(userToken) {
    const config = this.validateUserToken(userToken);
    if (!config) return { ok: false, message: "not found" };
    return this.clearLogs(config.id);
  }
}

