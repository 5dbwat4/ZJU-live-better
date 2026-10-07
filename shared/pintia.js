/** PTA 登录与题目集抓取，供仪表盘和 CLI 共用。 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, request } from "playwright";

const ORIGIN = "https://pintia.cn";
const STATE_PATH = fileURLToPath(new URL("../data/pintia/storage-state.json", import.meta.url));
const AUTH_CODES = new Set([
  "UNAUTHENTICATED", "UNAUTHORIZED", "LOGIN_REQUIRED", "NOT_LOGGED_IN", "SESSION_EXPIRED",
]);

export class PintiaError extends Error {
  constructor(code, message) {
    super(`[pintia] ${message}`);
    this.name = "PintiaError";
    this.code = code;
  }
}

export function getPintiaConfigStatus(env = process.env) {
  const username = Boolean(env.PINTIA_USERNAME?.trim());
  const password = Boolean(env.PINTIA_PASSWORD?.trim());
  if (username && password) return { configured: true, mode: "自动登录" };
  if (username || password) return { configured: false, mode: "账号密码配置不完整" };
  if (env.PINTIA_COOKIE?.trim()) return { configured: true, mode: "Cookie 登录" };
  return { configured: false, mode: "未配置" };
}

/** 使用正常网页表单登录；不尝试绕过验证码。错误信息不包含表单值。 */
export async function loginWithBrowser(
  { username, password, headless = true },
  browserType = chromium,
) {
  let browser;
  try {
    // PTA 使用直连，避免继承 Windows 系统代理（例如本机 7890）。
    browser = await browserType.launch({ headless, args: ["--no-proxy-server"] });
  } catch {
    throw new PintiaError("BROWSER_UNAVAILABLE", "无法启动 Chromium，请先运行 npx playwright install chromium。");
  }
  try {
    const context = await browser.newContext({ locale: "zh-CN" });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    try {
      await page.goto(`${ORIGIN}/auth/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
    } catch {
      throw new PintiaError("NETWORK", "无法打开 PTA 登录页，请检查能否访问 pintia.cn。");
    }

    const passwordInput = page.locator('input[type="password"]:visible').first();
    const passwordMode = page.getByText(/^(密码登录|账号密码登录)$/).first();
    await passwordInput.or(passwordMode).first().waitFor();
    if (!(await passwordInput.isVisible())) await passwordMode.click();
    await passwordInput.waitFor();

    const forms = passwordInput.locator("xpath=ancestor::form");
    const form = (await forms.count()) ? forms.first() : page.locator("body");
    let usernameInput = form.getByPlaceholder(/邮箱|手机号|手机号码|账号|用户名|email|phone|username/i)
      .or(form.locator('input[autocomplete="username"], input[type="email"], input[type="tel"], input[name="username"], input[name="email"]'))
      .filter({ visible: true }).first();
    if (!(await usernameInput.count())) usernameInput = form.locator('input[type="text"]:visible').first();
    await usernameInput.fill(username);
    await passwordInput.fill(password);

    const remember = form.getByRole("checkbox", { name: /记住我|保持登录|remember me/i }).first();
    if (await remember.isVisible()) await remember.check();
    const submit = form.getByRole("button", { name: /^(登\s*录|sign in|log in)$/i })
      .or(form.locator('input[type="submit"]')).filter({ visible: true }).first();
    await submit.click();

    // 人工模式给用户留出完成验证码的时间；自动模式失败后由调用方明确报告。
    await page.waitForURL(
      (url) => url.origin === ORIGIN && !url.pathname.startsWith("/auth/"),
      { timeout: headless ? 45000 : 180000 },
    );
    return await context.storageState();
  } catch (error) {
    if (error instanceof PintiaError) throw error;
    // Playwright 的 fill 错误可能带有密码，不能透传它的 message 或 cause。
    throw new PintiaError("LOGIN_FAILED", "登录未完成，请检查账号密码；如需验证码，请运行 npm run pintia:login 后在浏览器中完成验证。");
  } finally {
    await browser.close();
  }
}

function cookiesFromHeader(header) {
  return header.split(";").filter((part) => part.includes("=")).map((part) => {
    const index = part.indexOf("=");
    return {
      name: part.slice(0, index).trim(), value: part.slice(index + 1).trim(),
      domain: ".pintia.cn", path: "/", secure: true, httpOnly: true, sameSite: "Lax",
    };
  });
}

async function newRequestContext(storageState) {
  return request.newContext({
    baseURL: ORIGIN,
    timeout: 30000,
    storageState,
    extraHTTPHeaders: {
      Accept: "application/json;charset=UTF-8",
      "Accept-Language": "zh-CN",
      Referer: `${ORIGIN}/problem-sets/dashboard`,
    },
  });
}

export function createPintiaClient({
  env = process.env,
  statePath = STATE_PATH,
  createContext = newRequestContext,
  login = loginWithBrowser,
} = {}) {
  let inFlight = null;

  function credentials() {
    const username = env.PINTIA_USERNAME?.trim() || "";
    const password = env.PINTIA_PASSWORD || "";
    if (Boolean(username) !== Boolean(password.trim())) {
      throw new PintiaError("CONFIG", "请同时配置 PINTIA_USERNAME 和 PINTIA_PASSWORD。");
    }
    return { username, password };
  }

  function accountKey(username) {
    return username ? createHash("sha256").update(username).digest("hex") : null;
  }

  async function loadState(username) {
    try {
      const saved = JSON.parse(await readFile(statePath, "utf8"));
      if (saved.accountKey === accountKey(username) && Array.isArray(saved.storageState?.cookies)) {
        return saved.storageState;
      }
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) {
        throw new PintiaError("STATE", "无法读取本地登录状态，请检查 data/pintia 目录权限。");
      }
    }
    // 配置了账号密码时以该账号为准，不复用可能属于其他账号的手动 Cookie。
    if (!username && env.PINTIA_COOKIE?.trim()) {
      return { cookies: cookiesFromHeader(env.PINTIA_COOKIE), origins: [] };
    }
    return null;
  }

  async function saveState(username, storageState) {
    const temporary = `${statePath}.${randomUUID()}.tmp`;
    try {
      await mkdir(path.dirname(statePath), { recursive: true });
      await writeFile(temporary, JSON.stringify({ accountKey: accountKey(username), storageState }), { mode: 0o600 });
      await rename(temporary, statePath);
    } catch {
      throw new PintiaError("STATE", "无法保存本地登录状态，请检查 data/pintia 目录权限。");
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }

  async function fetchSets(context) {
    let response;
    try {
      response = await context.get("/api/problem-sets", {
        params: {
          filter: JSON.stringify({ endAtAfter: new Date().toISOString() }),
          limit: 100, order_by: "END_AT", asc: true,
        },
        maxRedirects: 0,
      });
    } catch {
      throw new PintiaError("NETWORK", "题目集请求失败，请检查网络连接。");
    }
    try {
      const status = response.status();
      const location = response.headers().location || "";
      let data = null;
      if (response.headers()["content-type"]?.includes("json")) {
        data = await response.json().catch(() => null);
      }
      const authCode = data?.error?.code || data?.code || data?.error;
      if (status === 401 || AUTH_CODES.has(authCode) ||
          (status >= 300 && status < 400 && /\/auth\/login/.test(location))) {
        throw new PintiaError("SESSION_EXPIRED", "PTA 登录状态已失效。");
      }
      if (status !== 200) {
        throw new PintiaError("HTTP", `题目集获取失败（HTTP ${status}），请检查权限或稍后重试。`);
      }
      if (!Array.isArray(data?.problemSets)) {
        throw new PintiaError("RESPONSE", "题目集响应格式异常，未将其当作空列表。");
      }
      return data.problemSets;
    } finally {
      await response.dispose();
    }
  }

  async function readWithState(username, storageState) {
    let context;
    try {
      context = await createContext(storageState);
      const sets = await fetchSets(context);
      // API 的 Set-Cookie 也会写入 cookie jar，避免丢失服务端轮换的会话。
      await saveState(username, await context.storageState());
      return sets;
    } finally {
      await context?.dispose();
    }
  }

  async function fetchProblemSets({ forceLogin = false, headless = true } = {}) {
    const { username, password } = credentials();
    const state = forceLogin ? null : await loadState(username);
    if (state) {
      try {
        return await readWithState(username, state);
      } catch (error) {
        if (error.code !== "SESSION_EXPIRED") throw error;
      }
    }
    if (!username) {
      if (!state && !forceLogin) return [];
      throw new PintiaError("CONFIG", "登录已失效，请配置 PINTIA_USERNAME 和 PINTIA_PASSWORD 以自动登录。");
    }
    const freshState = await login({ username, password, headless });
    // 登录后验证真实题目集接口，只有验证成功才持久化；最多重登一次。
    return readWithState(username, freshState);
  }

  return {
    getProblemSets(options) {
      // 同一进程的并发刷新共用一次登录和抓取，避免同时提交多次密码。
      if (!inFlight) {
        inFlight = fetchProblemSets(options).finally(() => { inFlight = null; });
      }
      return inFlight;
    },
  };
}

const client = createPintiaClient();
export const getPintiaProblemSets = (options) => client.getProblemSets(options);
