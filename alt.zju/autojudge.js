/* 自动评教 (alt.zju.edu.cn / 学生评教系统) */
// 给所有待评教课程的每位教师提交满分（5/5）评价。
// 启动时可选择「一键全部提交」或「交互选择课程后提交」。

import chalk from "chalk";
import inquirer from "inquirer";
import { ZJUAM } from "login-zju";
import "dotenv/config";

const z = new ZJUAM(process.env.ZJU_USERNAME, process.env.ZJU_PASSWORD);

const authorizeURL =
  "https://alt.zju.edu.cn/ua/login?platform=WEB&target=%2FstudentEvaluationBackend%2Flist";
const getListURL =
  "https://alt.zju.edu.cn/dapi/v2/tes/evaluation_plan_service/page_my_todo_plan_course_list";
const getCourseURL =
  "https://alt.zju.edu.cn/dapi/v2/tes/evaluation_plan_service/find_plan_courses_by_user";
const createFormURL =
  "https://alt.zju.edu.cn/dapi/v2/autoform/document_service/insert_document";
const saveJudgeURL =
  "https://alt.zju.edu.cn/dapi/v2/tes/evaluation_plan_service/save_plan_courses_by_user";

// 评教表单内容（全部满分)
const judgeInfo = {
  oadpflA: 5,
  cHfvSga: 5,
  iuFCIOj: 5,
  FtFBhMR: 5,
  UuWdHvl: 5,
  AskLXei: [
    { value: "SqszCjdd", label: "知识：系统地说明课程的核心知识或概念，以及它们之间的逻辑关系" },
    { value: "StFnMwbR", label: "方法：深层次掌握课程中的重要原理、方法或技能" },
    { value: "SimUtEdu", label: "应用：灵活地解释、分析或解决一些现实中的问题" },
    { value: "StGGVERJ", label: "思维：较大程度上获得思维拓展或逻辑思维提升" },
    { value: "SzEGpaIQ", label: "价值观：更深入地认识世界，并能够以积极的心态和视角看待" },
  ],
  nzLUDxN: [{ value: "SAhKrdxb", label: "无以上需要" }],
  MfKamDv: "SKNzmbSY",
  FanwXXp: "SezdRflh",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 带 Bearer JWT 的 POST，返回解析后的 JSON（非 JSON 响应原样返回到 __raw 以便排查）
async function post(url, jwt, payload) {
  const res = await z.fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + jwt, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { __raw: text };
  }
}

// 跟随重定向链，从 URL 的 ?token= 中取出评教系统的 JWT
async function getToken() {
  let res = await z.fetch(authorizeURL, {
    method: "GET",
    redirect: "manual",
    headers: { referer: "https://alt.zju.edu.cn/studentEvaluationBackend/list" },
  });
  let loc = res.headers.get("Location");
  let prev = authorizeURL;
  for (let hop = 0; hop < 20; hop++) {
    if (!loc) throw new Error(`重定向第 ${hop} 跳缺少 Location 头`);
    const u = new URL(loc, prev);
    const token = u.searchParams.get("token");
    if (token) return token;
    prev = u.toString();
    res = await z.fetch(prev, { redirect: "manual" });
    loc = res.headers.get("Location");
  }
  throw new Error("跟随 20 次重定向后仍未找到 token");
}

// 课程选择项的可读标签：优先用接口返回的 courseName，附带 id 方便区分
function courseLabel(course) {
  const name = course.courseName;
  return `${name}  ${chalk.gray(`[id:${course.id}]`)}`;
}

async function main() {
  try {
    const { mode } = await inquirer.prompt([
      {
        type: "list",
        name: "mode",
        message: "请选择评教方式：",
        choices: [
          { name: "一键全部提交（所有待评教课程，全部满分）", value: "all" },
          { name: "交互选择要评教的课程（全部满分）", value: "interactive" },
        ],
      },
    ]);

    console.log(chalk.blue("[AutoJudge] 正在登录并获取评教token..."));
    const jwt = await getToken();

    const listResp = await post(getListURL, jwt, { pageNum: 0, pageSize: 20 });
    const list = listResp?.data?.data ?? [];
    console.log(chalk.blue(`[AutoJudge] 找到 ${list.length} 门待评教课程`));

    if (list.length === 0) {
      console.log(chalk.yellow("没有待评教的课程，已退出。"));
      return;
    }

    let targets = list;
    if (mode === "interactive") {
      const { picked } = await inquirer.prompt([
        {
          type: "checkbox",
          name: "picked",
          message: "选择要评教的课程（空格选择，回车确认）：",
          pageSize: 20,
          loop: false,
          choices: list.map((course, i) => ({
            name: courseLabel(course),
            value: i,
            checked: true,
          })),
        },
      ]);

      if (picked.length === 0) {
        console.log(chalk.yellow("未选择任何课程，已退出。"));
        return;
      }
      targets = picked.map((i) => list[i]);

      const { confirm } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: `将以满分提交 ${targets.length} 门课程的评教，确认？`,
          default: false,
        },
      ]);
      if (!confirm) {
        console.log(chalk.yellow("已取消。"));
        return;
      }
    }

    let ok = 0;
    let fail = 0;
    for (const [i, course] of targets.entries()) {
      const id = String(course.id);

      const courseResp = await post(getCourseURL, jwt, { planCourseId: id });
      const groupId = courseResp?.data?.groupId;
      const teacherList = courseResp?.data?.teacherList ?? [];
      const courseName = courseResp?.data?.courseName || course.courseName || id;

      if (!groupId) {
        fail++;
        console.log(chalk.red(`[课程 ${i}] ${courseName} 获取详情失败，跳过。`));
        continue;
      }

      const formResp = await post(createFormURL, jwt, { groupId, value: judgeInfo });
      const formId = formResp?.data;
      if (!formId) {
        fail++;
        console.log(chalk.red(`[课程 ${i}] ${courseName} 创建评教表单失败，跳过。`));
        continue;
      }

      console.log(
        chalk.bold(`\n[课程 ${i}] ${courseName}  ${teacherList.length} 位教师`)
      );
      for (const [ti, teacher] of teacherList.entries()) {
        const sid = teacher.userSid;
        const teacherName = teacher.userName || sid;
        const saveResp = await post(saveJudgeURL, jwt, {
          planCourseId: id,
          teaching: true,
          formId,
          teaSid: sid,
        });

        if (saveResp?.code === 200) {
          ok++;
          console.log(chalk.green(`  教师[${ti}] ${teacherName} (${sid}) 成功`));
        } else {
          fail++;
          console.log(
            chalk.red(
              `  教师[${ti}] ${teacherName} (${sid}) 失败 code=${saveResp?.code} msg=${saveResp?.msg ?? saveResp?.message ?? ""}`
            )
          );
        }
        await sleep(200); // rate limit
      }
    }

    console.log(chalk.bold(`\n完成。成功 ${ok}，失败 ${fail}。`));
  } catch (error) {
    console.error(chalk.red("执行失败:"), error);
    process.exitCode = 1;
  }
}

main();
