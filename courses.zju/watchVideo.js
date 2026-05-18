/*
 * 学在浙大刷课脚本
 * 
 * 不基于视频倍速方案，而是直接向课程系统发送完成活动的请求。
 */

import inquirer from "inquirer";
import { COURSES, ZJUAM } from "login-zju";
import "dotenv/config";
import { pickCourseId } from "../shared/choose-a-course.js";

const CHUNK_SECONDS = 120;

const courses = new COURSES(
  new ZJUAM(process.env.ZJU_USERNAME, process.env.ZJU_PASSWORD)
);

const state = {
  requestSent: 0,
  totalRequest: 3,
  activityDone: 0,
  activityTotal: 0,
  currentActivityTitle: "",
  currentActivityRequestDone: 0,
  currentActivityRequestTotal: 0,
};

function renderProgress(lastInfo = "") {
  const line =
    `[Req ${state.requestSent}/${state.totalRequest}] ` +
    `[Activity ${state.activityDone+1}/${state.activityTotal}] ` +
    `[Current ${state.currentActivityRequestDone}/${state.currentActivityRequestTotal}] ` +
    `${state.currentActivityTitle}${lastInfo ? ` | ${lastInfo}` : ""}`;

  console.log(line);
}


async function requestJson(url, init, meta = "") {
  const res = await courses.fetch(url, init);
  state.requestSent += 1;
  state.currentActivityRequestDone += 1;
  renderProgress(meta || `${res.status} ${new URL(url).pathname}`);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} ${url} -> ${body}`);
  }

  return res.json();
}

async function requestText(url, init, meta = "") {
  const res = await courses.fetch(url, init);
  state.requestSent += 1;
  state.currentActivityRequestDone += 1;
  renderProgress(meta || `${res.status} ${new URL(url).pathname}`);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} ${url} -> ${body}`);
  }

  return res.text();
}

function getActivityRequestCount(activity) {
  const type = activity.type;
  const criterion = activity.completion_criterion_key;

  if (type === "online_video" && ["completeness", "none"].includes(criterion)) {
    const duration = Math.ceil(activity?.uploads?.[0]?.videos?.[0]?.duration || 0);
    return duration > 0 ? Math.ceil(duration / CHUNK_SECONDS) : 0;
  }

  if (["web_link", "page"].includes(type) && ["view", "none"].includes(criterion)) {
    return 1;
  }

  if (type === "material" && ["view", "none"].includes(criterion)) {
    return Array.isArray(activity.uploads) ? activity.uploads.length : 0;
  }

  return 0;
}

function buildActivityTasks(activities) {
  return activities
    .map((activity) => {
      const requestCount = getActivityRequestCount(activity);
      return {
        id: activity.id,
        title: activity.title,
        type: activity.type,
        requestCount,
        raw: activity,
      };
    })
    .filter((task) => task.requestCount > 0);
}

async function handleVideoTask(task) {
  const duration = Math.ceil(task.raw?.uploads?.[0]?.videos?.[0]?.duration || 0);
  for (let i = 0; i < duration / CHUNK_SECONDS; i += 1) {
    const start = i * CHUNK_SECONDS;
    const end = Math.min(duration, start + CHUNK_SECONDS);

    await requestText(
      `https://courses.zju.edu.cn/api/course/activities-read/${task.id}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ start, end }),
      },
      `[${start}-${end}]`
    );
  }

  state.activityDone += 1;
}

async function handleLinkOrPageTask(task) {
  await requestText(
    `https://courses.zju.edu.cn/api/course/activities-read/${task.id}`,
    {
      method: "POST",
    },
    ``
  );

  state.activityDone += 1;
}

async function handleMaterialTask(task) {
  for (const upload of task.raw.uploads || []) {
    await requestText(
      `https://courses.zju.edu.cn/api/course/activities-read/${task.id}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ upload_id: upload.id }),
      },
      `[upload:${upload.id}]`
    );
  }

  state.activityDone += 1;
}

async function resolveTask(task) {
  state.currentActivityTitle = task.title;
  state.currentActivityRequestDone = 0;
  state.currentActivityRequestTotal = task.requestCount;
  renderProgress("task start");

  if (task.type === "online_video") {
    await handleVideoTask(task);
    return;
  }

  if (["web_link", "page"].includes(task.type)) {
    await handleLinkOrPageTask(task);
    return;
  }

  if (task.type === "material") {
    await handleMaterialTask(task);
    return;
  }
}


async function main() {
  try {
    console.log("[watchVideo] Begins...");

    const courseId = await pickCourseId(courses);

    console.log(`\x1b[1m[3/4] Fetching activities ...\x1b[0m`);
    state.currentActivityTitle = "加载活动列表";
    state.currentActivityRequestDone = 0;
    state.currentActivityRequestTotal = 1;

    const activityResp = await requestJson(
      `https://courses.zju.edu.cn/api/courses/${courseId}/activities?sub_course_id=0`,
      undefined,
      `GET /api/courses/${courseId}/activities`
    );

    const allActivities = activityResp.activities || [];
    const tasks = buildActivityTasks(allActivities);
    const skipped = allActivities.length - tasks.length;

    state.activityTotal = tasks.length;
    state.totalRequest += tasks.reduce((sum, task) => sum + task.requestCount, 0);

    console.log(
      `\x1b[1m[4/4] 开始发送请求。预计请求 ${state.totalRequest} 次。\x1b[0m`
    );

    for (const task of tasks) {
      await resolveTask(task);
    }

    process.stdout.write("\n");
    console.log("\x1b[1mDone.\x1b[0m\n");
    console.log(`Visit https://courses.zju.edu.cn/course/${courseId}/content#/ to verify the result.`);
  } catch (error) {
    process.stdout.write("\n");
    console.error("执行失败:", error);
    process.exitCode = 1;
  }
}

main();
