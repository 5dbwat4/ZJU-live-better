# ZJU-live-better

A collection of useful scripts helping you live better in ZJU.

## 配置

创建文件`.env`，配置你的学号和密码

运行`npm install`安装依赖

如果你要使用 Pintia 待办抓取，在 `.env` 配置 PTA 的 `PINTIA_USERNAME`（登录邮箱或手机号）和 `PINTIA_PASSWORD`，然后运行 `npx playwright install chromium` 安装登录使用的浏览器。

运行 `npm run pintia:check` 可单独检查 PTA 的未截止题目集及截止时间。程序优先复用保存在 `data/pintia/storage-state.json` 的登录状态，失效后通过无头浏览器重新登录；网页登录和题目集请求使用直连，不使用系统代理。首次登录或风控要求验证码时，运行 `npm run pintia:login`，在打开的浏览器中完成验证，再继续自动抓取。

`courses.zju/reliableTodolist.js` 共用上述 PTA 登录逻辑。未配置账号密码时，仍支持手动设置 `PINTIA_COOKIE`。账号密码和会话文件不应提交到仓库。原有题目集请求每次最多获取 100 项。

使用时，在working dir下运行`node path/to/script`，其中`path/to/script`是指向脚本的路径，例如`classroom.zju/generateCourseMd`

也可以运行`npm link`将本项目链接到全局，然后可以直接在任意目录下运行`zlb`进入脚本选择

## 功能列表

### 学在浙大相关（`courses.zju/`）

| 功能 | 说明 |
| --- | --- |
| `todolist` | 生成作业待办事项列表 |
| `materialDown` | 下载课程所有素材 |
| `materialMaintainer` | 可以基于配置文件增量下载课程素材 |

* \* 部分脚本未列出 \* * 

### 智云课堂相关（`classroom.zju/`）

| 功能 | 说明 |
| --- | --- |
| ☆`generateCourseMd` | 将智云课堂语音识别&PPT图片生成Markdown文件 |
| `getVideoURL` | 获取指定课程视频链接 |

### 图书馆相关（`lib.zju/`）

| 功能 | 说明 |
| --- | --- |
| ☆`bookList` | 查询已借阅图书并操作续借 |

### zdbk 相关（`zdbk.zju/`）

| 功能 | 说明 |
| --- | --- |
| `gradeMonitor check` | 检查一次正式课程成绩并记录变化 |
| `gradeMonitor monitor` | 定时监控正式成绩，变化时发送钉钉通知（具体使用细节查看脚本开头注释） |

## 反馈

反馈使用问题可以添加QQ群：1042563780

## 免责声明

本项目仅供学习交流使用，请勿用于任何商业用途，请勿用于任何非法或违规用途。使用本项目前请务必了解并遵守浙江大学相关政策和规定。作者不对因使用本项目而导致的任何后果负责。

## Star History

<a href="https://www.star-history.com/?repos=5dbwat4%2FZJU-live-better&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=5dbwat4/ZJU-live-better&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=5dbwat4/ZJU-live-better&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=5dbwat4/ZJU-live-better&type=date&legend=top-left" />
 </picture>
</a>
