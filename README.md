# zju-autosign[AI generated]

`zju-autosign` 是一个服务器端自动打卡托管项目，核心脚本直接继承自 [5dbwat4/ZJU-live-better](https://github.com/5dbwat4/ZJU-live-better)，采用了其自动打卡逻辑，并在此基础上整合了数据管理、控制器界面、HTTPS 与钉钉告警等能力，方便以服务形式部署在 VPS 或校内服务器中。

## 快速上手

1. 克隆本仓库（或将已有目录直接复制进去）。
2. 复制 `.env.example` 为 `.env`，并根据注释填入 `APP_SECRET`、`CONTROL_TOKEN`、HTTPS 证书以及钉钉 Webhook 等配置。
3. 运行 `npm install` 安装依赖，后续只需 `npm run start` 启动控制服务器即可（默认监听 `CONTROL_PORT`）。

控制端配套的静态页面位于 `public/`，你可以通过 `CONTROL_PORT` 访问或在 Nginx 等前端代理下部署 HTTPS。

## 部署提示

- 生产环境建议开启 HTTPS，避免控制口令在明文传输。
- `.env` 中的 `ENABLE_DINGTALK` 可启用钉钉告警，配合 `shared/dingtalk-webhook.js` 发送关键事件提醒。
- `data/` 目录保存用户与邀请信息，建议定期备份并设置合理的读写权限。

## 授权

本项目以及借用的全部脚本均遵循 GPL-3.0 协议，详见仓库根目录的 `LICENSE`。如需二次开发或商用，请同时保留原始许可声明并公开源码。

## 贡献

欢迎在 `hzlgames/zju-autosign` 中提 Issue 或 Pull Request。如需引用本项目，请保留 README 中的项目说明与授权信息。

