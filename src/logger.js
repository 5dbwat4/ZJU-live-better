import fs from "fs/promises";
import path from "path";

const defaultDataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
const defaultLogDir = path.join(defaultDataDir, "logs");
const MAX_RECENT = 1000;
const MAX_FILE_LINES = 1000; // 文件中最多保留的日志行数

function maskUsername(username) {
  if (!username || typeof username !== "string") return username;
  if (username.length <= 6) return username;
  return `${username.slice(0, 4)}****${username.slice(-2)}`;
}

export class UserLogger {
  constructor({ userId, username, dingTalk, logDir = defaultLogDir } = {}) {
    this.userId = userId;
    this.username = username;
    this.usernameMasked = maskUsername(username);
    this.dingTalk = dingTalk;
    this.logDir = logDir;
    this.logPath = path.join(this.logDir, `${userId || "unknown"}.log`);
    this.recent = [];
    this._initPromise = this._ensureDirAndLoad();
  }

  async _ensureDirAndLoad() {
    await fs.mkdir(this.logDir, { recursive: true });
    try {
      const buf = await fs.readFile(this.logPath, "utf8");
      const lines = buf.split("\n").filter(Boolean);
      const parsed = lines
        .slice(-MAX_RECENT)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      this.recent = parsed;
    } catch {
      // file may not exist yet
      this.recent = [];
    }
  }

  async _append(entry) {
    await this._initPromise;
    const line = JSON.stringify(entry) + "\n";
    await fs.appendFile(this.logPath, line, "utf8");
    this.recent.push(entry);
    if (this.recent.length > MAX_RECENT) {
      this.recent.splice(0, this.recent.length - MAX_RECENT);
    }
    // 定期截断文件，只保留最新的 MAX_FILE_LINES 条
    this._truncateCounter = (this._truncateCounter || 0) + 1;
    if (this._truncateCounter >= 100) {
      this._truncateCounter = 0;
      this._truncateFile().catch(() => {});
    }
  }

  async _truncateFile() {
    try {
      const buf = await fs.readFile(this.logPath, "utf8");
      const lines = buf.split("\n").filter(Boolean);
      if (lines.length > MAX_FILE_LINES) {
        const kept = lines.slice(-MAX_FILE_LINES);
        await fs.writeFile(this.logPath, kept.join("\n") + "\n", "utf8");
      }
    } catch {
      // 忽略截断失败
    }
  }

  _buildEntry(level, message) {
    return {
      ts: new Date().toISOString(),
      level,
      userId: this.userId,
      username: this.usernameMasked,
      message,
    };
  }

  async log(level, message) {
    const entry = this._buildEntry(level, message);
    // stdout for quick debugging
    const prefix = `[${level.toUpperCase()}][${this.usernameMasked || this.userId}]`;
    console.log(prefix, message);
    await this._append(entry);
    // success/error/warn 推送到钉钉（按需）
    if (this.dingTalk && (level === "success" || level === "error" || level === "warn")) {
      try {
        await this.dingTalk(`${prefix} ${message}`);
      } catch (e) {
        console.error("[Logger] dingTalk failed:", e);
      }
    }
    return entry;
  }

  info(message) {
    return this.log("info", message);
  }

  success(message) {
    return this.log("success", message);
  }

  warn(message) {
    return this.log("warn", message);
  }

  error(message) {
    return this.log("error", message);
  }

  async getRecent() {
    await this._initPromise;
    return [...this.recent];
  }

  async clear() {
    await this._initPromise;
    this.recent = [];
    try {
      await fs.writeFile(this.logPath, "", "utf8");
    } catch {
      // 忽略清空失败
    }
    // 添加一条清屏记录
    await this.info("[System] 日志已清空");
  }
}



