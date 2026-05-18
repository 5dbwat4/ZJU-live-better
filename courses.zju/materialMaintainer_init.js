/* 初始化学在浙大课件维护配置文件 */

import inquirer from "inquirer";
import { COURSES, ZJUAM } from "login-zju";
import fs from "fs";
import path from "path";

import "dotenv/config";
import { pickCourseId } from "../shared/choose-a-course.js";

const coursesClient = new COURSES(
	new ZJUAM(process.env.ZJU_USERNAME, process.env.ZJU_PASSWORD)
);

const sanitizeFileName = (name) =>
	name
		.replace(/[\\/:*?"<>|]/g, "_")
		.replace(/\s+/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_|_$/g, "");


(async () => {
	const courseId = await pickCourseId(coursesClient);

	const { folder } = await inquirer.prompt({
		type: "input",
		name: "folder",
		message: "请输入配置文件存放文件夹\nWindows下，可以直接将文件夹拖入终端窗口以获取路径：",
		default: process.cwd(),
		validate: (input) =>
			input && input.trim() ? true : "文件夹路径不能为空",
	});

	const resolvedFolder = path.resolve(folder.replace(/\"/g, "").trim());
	fs.mkdirSync(resolvedFolder, { recursive: true });

	const defaultName = `.cache.json`;
	const cacheFile = path.join(resolvedFolder, defaultName);

	if (fs.existsSync(cacheFile)) {
		const { overwrite } = await inquirer.prompt({
			type: "confirm",
			name: "overwrite",
			message: `配置文件已存在：${cacheFile}，是否覆盖？`,
			default: false,
		});
		if (!overwrite) {
			console.log("已取消初始化。");
			return;
		}
	}

	const config = {
		root: resolvedFolder,
		xid: String(courseId),
		cache: [],
	};

	fs.writeFileSync(cacheFile, JSON.stringify(config, null, 2), "utf-8");
	console.log(`初始化完成：${cacheFile}`);
})();
