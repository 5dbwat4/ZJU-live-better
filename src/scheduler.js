/**
 * 简单时间窗口调度器（本地时间）。
 * - startTime/endTime 形如 "08:00"；如果 startTime === endTime，则视为关闭自动窗口，只能手动控制。
 * - enableSchedule 为 true 时，每 30 秒检查一次：当前时间在窗口内则启动，否则停止。
 */

const parseHHMM = (str) => {
  if (!str) return null;
  const [h, m] = str.split(":").map((v) => parseInt(v, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return { h, m };
};

const isNowInWindow = (start, end) => {
  if (!start || !end) return false;
  const now = new Date();
  const toMinutes = (t) => t.h * 60 + t.m;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  if (startMinutes === endMinutes) return false; // 视为关闭
  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  // 跨天窗口，如 22:00-07:00
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
};

export class Scheduler {
  constructor(
    autoSignCore,
    { startTime = "08:00", endTime = "22:00", enableSchedule = false, transitionDelayMs = 3000 } = {}
  ) {
    this.core = autoSignCore;
    this.enableSchedule = enableSchedule;
    this.startTime = parseHHMM(startTime);
    this.endTime = parseHHMM(endTime);
    this.timer = null;
    this.overrideUntil = null; // Date | null
    this.overrideMode = null; // "suppressStart" | "forceRun" | null
    this.transitionDelayMs = transitionDelayMs;
    this.transitioning = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 30 * 1000);
    // 立即跑一次
    this.tick();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async updateWindow({ startTime, endTime, enableSchedule }) {
    const wasEnabled = this.enableSchedule;
    if (typeof enableSchedule === "boolean") {
      this.enableSchedule = enableSchedule;
    }
    if (startTime) this.startTime = parseHHMM(startTime);
    if (endTime) this.endTime = parseHHMM(endTime);
    // 调度配置变更优先级最高：清空手动覆盖并立即应用
    this.overrideUntil = null;
    this.overrideMode = null;
    // 如果调度从开启变为关闭，需要停止当前运行的 core
    if (wasEnabled && !this.enableSchedule && this.core.running) {
      await this._transitionTo(false);
    } else {
      // 立刻检查一次（忽略覆盖状态）
      await this.tick({ ignoreOverride: true });
    }
  }

  nextStartDate() {
    if (!this.startTime) return null;
    const now = new Date();
    const candidate = new Date(now);
    candidate.setHours(this.startTime.h, this.startTime.m, 0, 0);
    if (candidate <= now) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate;
  }

  setOverride(mode, untilDate) {
    this.overrideMode = mode;
    this.overrideUntil = untilDate || null;
  }

  _clearOverrideIfExpired() {
    if (this.overrideUntil && new Date() >= this.overrideUntil) {
      this.overrideUntil = null;
      this.overrideMode = null;
    }
  }

  async tick(options = {}) {
    const { ignoreOverride = false } = options;
    if (!this.enableSchedule) return;
    this._clearOverrideIfExpired();
    if (!ignoreOverride && this.overrideUntil && this.overrideMode) {
      // 在覆盖期内，保持用户确认的手动状态，不做自动切换
      return;
    }
    const inWin = isNowInWindow(this.startTime, this.endTime);
    const shouldRun = inWin;
    if (shouldRun !== this.core.running && !this.transitioning) {
      await this._transitionTo(shouldRun);
    }
  }

  isCurrentlyInWindow() {
    return isNowInWindow(this.startTime, this.endTime);
  }

  pauseUntilNextWindowStart() {
    const nextStart = this.nextStartDate();
    if (nextStart) {
      this.setOverride("forceRun", nextStart);
    }
  }

  pauseUntilTomorrow() {
    // 恢复时间点 = 下一次窗口开始（符合“明天才有效”的语义，跨天窗口也适用）
    const resume = this.nextStartDate();
    if (resume) {
      this.setOverride("suppressStart", resume);
    }
  }

  getStatus() {
    return {
      enableSchedule: this.enableSchedule,
      startTime: this.startTime,
      endTime: this.endTime,
      timerRunning: !!this.timer,
      overrideMode: this.overrideMode,
      overrideUntil: this.overrideUntil,
    };
  }

  async _transitionTo(shouldRun) {
    this.transitioning = true;
    try {
      // 先停止，留出冷却时间，再按目标状态处理
      if (this.core.running) {
        await this.core.stop();
      }
      if (this.transitionDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.transitionDelayMs));
      }
      if (shouldRun) {
        await this.core.start();
      }
    } finally {
      this.transitioning = false;
    }
  }
}

export const _testHelpers = { parseHHMM, isNowInWindow };

