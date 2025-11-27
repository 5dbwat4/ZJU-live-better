# ZJU-live-better

针对浙江大学常用教学与行政平台的实用脚本集合，旨在让日常学习生活更省心。

## 功能一览

- `classroom.zju/getVideoURL.js`：列出课堂在线课程，获取回放地址，可选地调用自定义播放器播放（支持通过环境变量配置启动命令）。
- `courses.zju/autosign.js`：自动轮询“学在浙大”点名任务，支持雷达点名与数字点名，并可通过钉钉机器人推送结果。
- `courses.zju/materialDown.js`：批量下载课程资料，提供进度条反馈。
- `courses.zju/materialMaintainer.js`：基于自定义缓存文件维护课程资料本地镜像，避免重复下载。
- `courses.zju/quizanswer.js`：获取互动课堂 Quiz 题目与答案，可生成便于浏览的 HTML 文件。
- `courses.zju/todolist.js`：展示待办任务列表，附带截止时间和提交入口提示。
- `webplus.zju/saveDoc.js`：备份 WebPlus 通知正文并按原始名称下载所有附件，默认保存到用户文档目录下的 `WebPlusArchive` 文件夹。

## 环境要求

- Node.js 18 或更新版本（依赖内置 `fetch`）。
- 已开通对应平台访问权限的浙大统一身份认证账号。
- 某些脚本需要外部工具或配置：例如 PotPlayer 路径、钉钉机器人 Webhook。

## 安装与配置

1. 克隆仓库后在根目录创建 `.env`，写入：

	```env
	ZJU_USERNAME=你的学号
	ZJU_PASSWORD=你的统一认证密码
	DINGTALK_WEBHOOK=可选，钉钉机器人地址
	DINGTALK_SECRET=可选，钉钉机器人签名密钥
	MEDIA_PLAYER_CMD=可选，自定义播放器启动命令
	MEDIA_PLAYER_ARGS=可选，自定义播放器命令行参数（以空格分隔）
	```

2. 安装依赖：

	```bash
	npm install
	# 或者
	pnpm install
	```

3. 针对特定脚本完成额外配置，例如设置播放器相关环境变量、创建 `materialMaintainer` 所需的 `.cache.json` 等。

## 使用方法

- 运行脚本时保持当前工作目录在仓库根目录，以便正确读取 `.env`。
- 使用 Node.js 直接执行脚本，例如：

  ```bash
  node courses.zju/autosign.js
  node classroom.zju/getVideoURL.js
  node webplus.zju/saveDoc.js -u https://example.com/detail -o ./output
  ```

- 若脚本需要交互输入，按照终端提示操作即可。

## 注意事项

- 所有脚本均基于 `login-zju` 完成统一认证，请妥善保管 `.env` 中的账号密码。
- 自动签到、自动下载等操作可能受平台策略变动影响，使用前请评估风险并遵守相关规定。
- 如遇接口变更或脚本异常，欢迎提交 Issue 反馈或自行修复。

## 反馈

遇到问题可加入交流群：1042563780。