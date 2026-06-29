/* 自动评教 (alt.zju.edu.cn / 学生评教系统) */
// 给所有待评教课程的每位教师提交满分（5/5）评价。
// 登录与鉴权复用 login-zju 的 ALT（自动跟随重定向取 token 并注入 Bearer 头）。
// 启动时可选择「一键全部提交」或「逐门课程确认后提交」。

import chalk from "chalk";
import inquirer from "inquirer";
import { ALT, ZJUAM } from "login-zju";
import "dotenv/config";

const alt = new ALT(
  new ZJUAM(process.env.ZJU_USERNAME, process.env.ZJU_PASSWORD)
);

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

// 评教接口 POST 封装。鉴权（Bearer token）与 Content-Type 由 ALT 自动注入；
// ALT.fetch 在非 200 时会抛错，故调用处需自行 try/catch。
async function post(url, payload) {
  const res = await alt.fetch(url, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.json();
}

// 提交某门课程：创建评教表单并为指定教师逐个提交满分
async function submitCourse(id, courseName, groupId, teacherList) {
  let ok = 0;
  let fail = 0;

  let formId;
  try {
    const formResp = await post(createFormURL, { groupId, value: judgeInfo });
    formId = formResp?.data;
  } catch (e) {
    console.log(chalk.red(`  [${courseName}] 创建评教表单失败：${e.message}`));
    return { ok, fail: teacherList.length };
  }
  if (!formId) {
    console.log(chalk.red(`  [${courseName}] 创建评教表单失败，跳过。`));
    return { ok, fail: teacherList.length };
  }

  for (const [ti, teacher] of teacherList.entries()) {
    const sid = teacher.userSid;
    const teacherName = teacher.userName || sid;
    try {
      const saveResp = await post(saveJudgeURL, {
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
    } catch (e) {
      fail++;
      console.log(chalk.red(`  教师[${ti}] ${teacherName} (${sid}) 失败：${e.message}`));
    }
    await sleep(200); // rate limit
  }

  return { ok, fail };
}

// 教师选择项标签（标注已评教的教师）
function teacherLabel(teacher) {
  const name = teacher.userName || teacher.userSid;
  const filled = teacher.filled ? chalk.yellow("（已评）") : "";
  return `${name} (${teacher.userSid})${filled}`;
}

async function main() {
  try {
    const { mode } = await inquirer.prompt([
      {
        type: "list",
        name: "mode",
        message: "请选择评教方式：",
        choices: [
          { name: "一键全部提交", value: "all" },
          { name: "逐门课程确认后提交", value: "interactive" },
        ],
      },
    ]);

    console.log(chalk.blue("[AutoJudge] 正在登录并获取待评教课程..."));
    const listResp = await post(getListURL, { pageNum: 0, pageSize: 20 });
    const list = listResp?.data?.data ?? [];
    console.log(chalk.blue(`[AutoJudge] 找到 ${list.length} 门待评教课程`));

    if (list.length === 0) {
      console.log(chalk.yellow("没有待评教的课程，已退出。"));
      return;
    }

    let ok = 0;
    let fail = 0;

    // 逐门课程处理：交互模式下每门课单独询问，一键模式下直接提交
    for (const [i, course] of list.entries()) {
      const id = String(course.id);
      const tag = `[课程 ${i + 1}/${list.length}]`;

      let detail;
      try {
        detail = (await post(getCourseURL, { planCourseId: id }))?.data;
      } catch (e) {
        fail++;
        console.log(chalk.red(`${tag} 获取课程详情失败：${e.message}`));
        continue;
      }
      const groupId = detail?.groupId;
      const teacherList = detail?.teacherList ?? [];
      const courseName = detail?.courseName ?? id;

      if (!groupId) {
        fail++;
        console.log(chalk.red(`${tag} ${courseName} 获取详情失败，跳过。`));
        continue;
      }

      let chosenTeachers = teacherList;

      if (mode === "interactive") {
        const names = teacherList.map((t) => t.userName || t.userSid).join("、");
        console.log(
          chalk.bold(`\n${tag} ${courseName}`) +
            chalk.gray(`  ${teacherList.length} 位教师：${names}`)
        );

        const { action } = await inquirer.prompt([
          {
            type: "list",
            name: "action",
            message: "如何处理本门课程？",
            choices: [
              { name: "提交（全部教师满分）", value: "all" },
              { name: "选择教师后提交（满分）", value: "select" },
              { name: "跳过本课程", value: "skip" },
              { name: "退出", value: "quit" },
            ],
          },
        ]);

        if (action === "quit") {
          console.log(chalk.yellow("已退出。"));
          break;
        }
        if (action === "skip") {
          console.log(chalk.gray("已跳过。"));
          continue;
        }
        if (action === "select") {
          const { picked } = await inquirer.prompt([
            {
              type: "checkbox",
              name: "picked",
              message: "选择要评教的教师（空格选择，回车确认）：",
              loop: false,
              choices: teacherList.map((t, ti) => ({
                name: teacherLabel(t),
                value: ti,
                checked: true,
              })),
            },
          ]);
          if (picked.length === 0) {
            console.log(chalk.gray("未选择教师，已跳过本课程。"));
            continue;
          }
          chosenTeachers = picked.map((ti) => teacherList[ti]);
        }
      } else {
        console.log(
          chalk.bold(`\n${tag} ${courseName}  ${teacherList.length} 位教师`)
        );
      }

      const r = await submitCourse(id, courseName, groupId, chosenTeachers);
      ok += r.ok;
      fail += r.fail;
    }

    console.log(chalk.bold(`\n完成。成功 ${ok}，失败 ${fail}。`));
  } catch (error) {
    console.error(chalk.red("执行失败:"), error);
    process.exitCode = 1;
  }
}

main();
