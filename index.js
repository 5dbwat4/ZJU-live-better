import { config } from "dotenv";
config();
import chalk from "chalk";
import dingTalk from "./shared/dingtalk-webhook.js";
import fs from "fs";
import { createControlServer } from "./src/control-server.js";
import { UserStore } from "./src/user-store.js";
import { UserManager } from "./src/user-manager.js";

const {
  CONTROL_TOKEN = "",
  CONTROL_PORT = "3000",
  APP_SECRET,
  HTTPS_KEY = "",
  HTTPS_CERT = "",
  HTTPS_CA = "",
} = process.env;

if (!APP_SECRET) {
  console.error(chalk.red("[Auto Sign-in] 缺少 APP_SECRET，用于加密存储用户密码。"));
  process.exit(1);
}

if (!CONTROL_TOKEN || CONTROL_TOKEN.length < 16) {
  console.error(chalk.red("[Security] CONTROL_TOKEN 必须设置且长度至少 16 字符。"));
  process.exit(1);
}

async function bootstrap() {
  const store = new UserStore({ secret: APP_SECRET });
  const manager = new UserManager({
    store,
    dingTalk,
    controlNotify: dingTalk,
  });
  await manager.init();

  // 读取 HTTPS 证书（若配置）
  let httpsOptions = null;
  if (HTTPS_KEY && HTTPS_CERT) {
    try {
      httpsOptions = {
        key: fs.readFileSync(HTTPS_KEY),
        cert: fs.readFileSync(HTTPS_CERT),
        // 显式指定 ALPN 协议为 HTTP/1.1，避免客户端尝试 HTTP/2 导致 ERR_HTTP2_PROTOCOL_ERROR
        ALPNProtocols: ['http/1.1'],
        // 强制锁定在 TLS 1.2，避免 TLS 1.3 带来的兼容性问题或隐式 HTTP/2 升级尝试
        minVersion: "TLSv1.2",
        maxVersion: "TLSv1.2",
      };
      if (HTTPS_CA) {
        httpsOptions.ca = fs.readFileSync(HTTPS_CA);
      }
    } catch (e) {
      console.error(chalk.red(`[Auto Sign-in] 读取 HTTPS 证书失败: ${e.message}`));
      process.exit(1);
    }
  }

  createControlServer({
    manager,
    token: CONTROL_TOKEN,
    port: Number(CONTROL_PORT) || 3000,
    httpsOptions,
  });

  console.log(
    chalk.green(
      `[Auto Sign-in] Multi-user service started. ${httpsOptions ? "HTTPS" : "HTTP"} Control API on port ${CONTROL_PORT}.`
    )
  );
}

bootstrap().catch((e) => {
  console.error(chalk.red("[Auto Sign-in] Failed to start:"), e);
  process.exit(1);
});

