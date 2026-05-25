/* 获取学在浙大作业和考试分数 */
/*
Original License: MIT
Original Author: Cold_Ink
Original Works: https://greasyfork.org/en/scripts/498454-display-homework-and-exam-scores-for-courses-filtered-sorted/code
Modified by 5dbwat4
*/

import chalk from "chalk";
import { COURSES, ZJUAM } from "login-zju";
import "dotenv/config";
import { pickCourseId } from "../shared/choose-a-course.js";

const courses = new COURSES(
  new ZJUAM(process.env.ZJU_USERNAME, process.env.ZJU_PASSWORD)
);

function displayScores(activityReadsData, homeworkScoresData, examScoresData, examsData) {
  const activityReads = activityReadsData.activity_reads;
  const homeworkActivities = homeworkScoresData.homework_activities;
  const examScores = examScoresData.exam_scores;
  const exams = examsData.exams;

  if ((!activityReads || activityReads.length === 0) && (!examScores || examScores.length === 0)) {
    console.log(chalk.yellow("当前课程没有作业或考试数据。"));
    return;
  }

  if ((!homeworkActivities || homeworkActivities.length === 0) && (!exams || exams.length === 0)) {
    console.log(chalk.yellow("没有作业或考试活动标题数据。"));
    return;
  }

  const homeworkMap = new Map();
  if (homeworkActivities) {
    homeworkActivities.forEach((a) => homeworkMap.set(a.id, a.title));
  }

  const examsMap = new Map();
  if (exams) {
    exams.forEach((e) => examsMap.set(e.id, e.title));
  }

  const homeworkScoresMap = new Map();
  if (activityReads) {
    activityReads.forEach((ar) => {
      if (homeworkMap.has(ar.activity_id)) {
        const score =
          ar.data && ar.data.score !== undefined && ar.data.score !== null
            ? ar.data.score
            : "—";
        homeworkScoresMap.set(ar.activity_id, score);
      }
    });
  }

  const examScoresMap = new Map();
  if (examScores) {
    examScores.forEach((es) => {
      if (es.activity_id !== 0) {
        const score =
          es.score !== undefined && es.score !== null ? es.score : "—";
        examScoresMap.set(es.activity_id, score);
      }
    });
  }

  const combinedActivityIds = new Set([
    ...homeworkScoresMap.keys(),
    ...examScoresMap.keys(),
  ]);

  if (combinedActivityIds.size === 0) {
    console.log(chalk.yellow("没有匹配的作业或考试数据。"));
    return;
  }

  const sortedIds = [...combinedActivityIds].sort((a, b) => a - b);

  const titleWidth = Math.max(
    ...sortedIds.map((id) => {
      const title = homeworkScoresMap.has(id)
        ? homeworkMap.get(id) || `作业 ID ${id}`
        : examsMap.get(id) || `考试 ID ${id}`;
      return title.length;
    }),
    4
  );

  console.log(chalk.bold("\n作业与考试分数\n"));

  for (const id of sortedIds) {
    let title, score, type;

    if (homeworkScoresMap.has(id)) {
      title = homeworkMap.get(id) || `作业 ID ${id}`;
      score = homeworkScoresMap.get(id);
      type = "作业";
    } else {
      title = examsMap.get(id) || `考试 ID ${id}`;
      score = examScoresMap.get(id);
      type = "考试";
    }

    const scoreStr =
      score === "—" ? chalk.gray("—") : chalk.green(String(score));
    const typeStr = chalk.cyan(`[${type}]`);
    console.log(
      `  ${chalk.bold(title.padEnd(titleWidth + 2))}${typeStr}  ${scoreStr}`
    );
  }

  console.log("");
}

async function main() {
  try {
    const courseId = await pickCourseId(courses);

    console.log(chalk.blue("[Scores] 正在获取分数数据..."));

    const [
      activityReadsData,
      homeworkScoresData,
      examScoresData,
      examsData,
    ] = await Promise.all([
      courses
        .fetch(
          `https://courses.zju.edu.cn/api/course/${courseId}/activity-reads-for-user`
        )
        .then((r) => r.json()),
      courses
        .fetch(
          `https://courses.zju.edu.cn/api/course/${courseId}/homework-scores?fields=id,title`
        )
        .then((r) => r.json()),
      courses
        .fetch(
          `https://courses.zju.edu.cn/api/courses/${courseId}/exam-scores?no-intercept=true`
        )
        .then((r) => r.json()),
      courses
        .fetch(`https://courses.zju.edu.cn/api/courses/${courseId}/exams`)
        .then((r) => r.json()),
    ]);

    displayScores(
      activityReadsData,
      homeworkScoresData,
      examScoresData,
      examsData
    );
  } catch (error) {
    console.error(chalk.red("执行失败:"), error);
    process.exitCode = 1;
  }
}

main();
