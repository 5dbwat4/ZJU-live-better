# ZJU-live-better

A collection of useful scripts helping you live better in ZJU.

## 配置

创建文件`.env`，配置你的学号和密码

运行`npm install`安装依赖

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




## 反馈

反馈使用问题可以添加QQ群：1042563780

## 免责声明

本项目仅供学习交流使用，请勿用于任何商业用途，请勿用于任何非法或违规用途。使用本项目前请务必了解并遵守浙江大学相关政策和规定。作者不对因使用本项目而导致的任何后果负责。