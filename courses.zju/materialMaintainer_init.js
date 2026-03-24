/* 初始化学在浙大课件维护配置文件 */

import inquirer from "inquirer";
import { COURSES, ZJUAM } from "login-zju";
import fs from "fs";
import path from "path";

import "dotenv/config";

const coursesClient = new COURSES(
	new ZJUAM(process.env.ZJU_USERNAME, process.env.ZJU_PASSWORD)
);

const sanitizeFileName = (name) =>
	name
		.replace(/[\\/:*?"<>|]/g, "_")
		.replace(/\s+/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_|_$/g, "");

const getActiveSemesters = async () => {
	const response = await coursesClient.fetch(
		"https://courses.zju.edu.cn/api/my-semesters?fields=id,name,sort,is_active,code"
	);
	const { semesters } = await response.json();
	return semesters.filter((semester) => semester.is_active);
};

const getCourses = async (semesterIds) => {
	const coursesFetchParam = new URLSearchParams();
	coursesFetchParam.set("page", "1");
	coursesFetchParam.set("page_size", "1000");
	coursesFetchParam.set("sort", "all");
	coursesFetchParam.set("normal", '{"version":7,"apiVersion":"1.1.0"}');
	coursesFetchParam.set(
		"conditions",
		JSON.stringify({
			role: [],
			semester_id: semesterIds,
			academic_year_id: [],
			status: ["ongoing", "notStarted"],
			course_type: [],
			effectiveness: [],
			published: [],
			display_studio_list: false,
		})
	);
	coursesFetchParam.set(
		"fields",
		"id,org_id,name,second_name,department(id,name),instructors(name),grade(name),klass(name),cover,learning_mode,course_attributes(teaching_class_name,data),public_scope,course_type,course_code,compulsory,credit,second_name"
	);

	const response = await coursesClient.fetch(
		"https://courses.zju.edu.cn/api/my-courses?" + coursesFetchParam.toString()
	);
	const { courses } = await response.json();
	return courses;
};

(async () => {
	const semesters = await getActiveSemesters();
	if (!semesters.length) {
		console.error("当前没有可用学期，无法初始化配置文件。");
		process.exit(1);
	}

	const courses = await getCourses(semesters.map((v) => v.id));
	if (!courses.length) {
		console.error("当前没有可选课程，无法初始化配置文件。");
		process.exit(1);
	}

	const { course } = await inquirer.prompt({
		type: "list",
		name: "course",
		message: "请选择课程：",
		loop: true,
		choices: courses.map((v) => ({
			name: v.name,
			value: v,
		})),
	});

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
		xid: String(course.id),
		cache: [],
	};

	fs.writeFileSync(cacheFile, JSON.stringify(config, null, 2), "utf-8");
	console.log(`初始化完成：${cacheFile}`);
})();
