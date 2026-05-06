/* 获取待完成作业列表（可靠版本）
 * courses.zju.edu.cn: 遍历所有课程获取作业，避免 /api/todos 的 bug
 * pintia.cn: 获取近期未截止的 problem sets
 */

import { COURSES, ZJUAM } from "login-zju";
import axios from "axios";
import "dotenv/config";

// 工具函数

function time_later(end) {
  const delta = end.getTime() - new Date().getTime();
  const units = ["days", "hours", "minutes"];
  let unit = units[0];
  let value = Math.floor(delta / (1000 * 60 * 60 * 24));
  if (value === 0) {
    unit = units[1];
    value = Math.floor(delta / (1000 * 60 * 60));
    if (value === 0) {
      unit = units[2];
      value = Math.floor(delta / (1000 * 60));
    }
  }
  return `${value} ${unit}`;
}

async function fetchPintiaProblemSets(cookie, filter) {
  return axios.get("https://pintia.cn/api/problem-sets", {
    params: {
      filter,
      limit: 100,
      order_by: "END_AT",
      asc: true,
    },
    headers: {
      Accept: "application/json;charset=UTF-8",
      "Accept-Language": "zh-CN",
      Cookie: cookie,
      Referer: "https://pintia.cn/problem-sets/dashboard",
    },
    validateStatus: () => true,
  });
}

function todoSortTime(todo) {
  return todo.end_time ? todo.end_time.getTime() : Number.POSITIVE_INFINITY;
}

function formatDueLine(endTime) {
  if (!endTime) return "No DDL";
  return `Remains ${time_later(endTime)} (DDL ${endTime.toLocaleString()})`;
}

// courses.zju.edu.cn

async function getCoursesZjuTodos() {
  const courses = new COURSES(
    new ZJUAM(process.env.ZJU_USERNAME, process.env.ZJU_PASSWORD)
  );

  // 1. 获取活跃学期
  const semestersResp = await courses.fetch(
    "https://courses.zju.edu.cn/api/my-semesters?fields=id,name,sort,is_active,code"
  );
  const { semesters } = await semestersResp.json();
  const activeSemesters = semesters.filter((s) => s.is_active);

  // 2. 获取活跃学期的所有课程
  const coursesFetchParam = new URLSearchParams();
  coursesFetchParam.set("page", "1");
  coursesFetchParam.set("page_size", "1000");
  coursesFetchParam.set("sort", "all");
  coursesFetchParam.set("normal", '{"version":7,"apiVersion":"1.1.0"}');
  coursesFetchParam.set(
    "conditions",
    JSON.stringify({
      role: [],
      semester_id: activeSemesters.map((v) => v.id),
      academic_year_id: [],
      status: ["ongoing", "notStarted"],
      course_type: [],
      effectiveness: [],
      published: [],
      display_studio_list: false,
    })
  );
  coursesFetchParam.set("fields", "id,name,course_code");

  const coursesResp = await courses.fetch(
    "https://courses.zju.edu.cn/api/my-courses?" + coursesFetchParam.toString()
  );
  const { courses: courseList } = await coursesResp.json();

  // 3. 并发获取每门课程的 activities，过滤出已开始且未截止的条目
  const now = new Date();
  const todos = [];

  await Promise.all(
    courseList.map(async (course) => {
      const isActive = (item) => {
        if (!item.published) return false;
        if (!item.end_time) return false;
        if (new Date(item.end_time) <= now) return false;
        if (item.start_time && new Date(item.start_time) > now) return false;
        return true;
      };

      const [
        { activities },
        { exams },
        { homework_activities },
        { exam_ids: submittedExamIds },
        { classrooms },
      ] = await Promise.all([
        courses.fetch(`https://courses.zju.edu.cn/api/courses/${course.id}/activities`).then((r) => r.json()).catch(() => ({ activities: [] })),
        courses.fetch(`https://courses.zju.edu.cn/api/courses/${course.id}/exams`).then((r) => r.json()).catch(() => ({ exams: [] })),
        courses.fetch(`https://courses.zju.edu.cn/api/course/${course.id}/homework/submission-status?no-intercept=true`).then((r) => r.json()).catch(() => ({ homework_activities: [] })),
        courses.fetch(`https://courses.zju.edu.cn/api/courses/${course.id}/submitted-exams?no-intercept=true`).then((r) => r.json()).catch(() => ({ exam_ids: [] })),
        courses.fetch(`https://courses.zju.edu.cn/api/courses/${course.id}/classroom-list`).then((r) => r.json()).catch(() => ({ classrooms: [] })),
      ]);

      const submittedHomeworkIds = new Set(
        (homework_activities || []).filter((h) => h.status_code === "submitted").map((h) => h.id)
      );
      const submittedExamIdSet = new Set(submittedExamIds || []);

      for (const activity of activities || []) {
        if (!isActive(activity)) continue;
        if (activity.type === "homework" && submittedHomeworkIds.has(activity.id)) continue;
        if (activity.completion_criterion_key === "score" && parseFloat(activity.score_percentage) >= 1) continue;
        todos.push({
          title: activity.title,
          course_name: course.name,
          course_id: course.id,
          id: activity.id,
          end_time: new Date(activity.end_time),
          type: activity.type,
          source: "courses.zju",
        });
      }

      for (const exam of exams || []) {
        if (!isActive(exam)) continue;
        if (submittedExamIdSet.has(exam.id)) continue;
        todos.push({
          title: exam.title,
          course_name: course.name,
          course_id: course.id,
          id: exam.id,
          end_time: new Date(exam.end_time),
          type: "quiz",
          source: "courses.zju",
        });
      }

      for (const classroom of classrooms || []) {
        if (classroom.status !== "start") continue;
        if (classroom.start_at && new Date(classroom.start_at) > now) continue;
        if (classroom.end_at && new Date(classroom.end_at) <= now) continue;
        todos.push({
          title: classroom.title,
          course_name: course.name,
          course_id: course.id,
          id: classroom.id,
          end_time: classroom.end_at ? new Date(classroom.end_at) : null,
          type: "interaction",
          source: "courses.zju",
        });
      }
    })
  );

  return todos;
}

// pintia.cn

async function getPintiaTodos() {
  const cookie = process.env.PINTIA_COOKIE?.trim();
  if (!cookie) {
    console.error("[pintia] 未配置 PINTIA_COOKIE，跳过 pintia 作业获取。");
    return [];
  }

  // 4. 获取近期未截止的 problem sets（endAtAfter = 昨天 UTC 0点）
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);
  const filter = JSON.stringify({ endAtAfter: yesterday.toISOString() });

  const psResp = await fetchPintiaProblemSets(cookie, filter);
  if (psResp.status !== 200) {
    throw new Error(
      `[pintia] 获取作业列表失败 (${psResp.status}): ${JSON.stringify(psResp.data)}`
    );
  }

  const { problemSets = [] } = psResp.data || {};
  const now = new Date();

  return problemSets
    .filter((ps) => ps.endAt && new Date(ps.endAt) > now)
    .map((ps) => ({
      title: ps.name,
      course_name: ps.organizationName || ps.ownerNickname || "pintia",
      id: ps.id,
      end_time: new Date(ps.endAt),
      source: "pintia",
    }));
}

// 主流程

(async () => {
  console.log("正在获取作业列表...\n");

  const [zjuTodos, pintiaTodos] = await Promise.allSettled([
    getCoursesZjuTodos(),
    getPintiaTodos(),
  ]).then((results) =>
    results.map((r) => {
      if (r.status === "rejected") {
        console.error("[!] 获取失败:", r.reason?.message || r.reason);
        return [];
      }
      return r.value;
    })
  );

  const allTodos = [...zjuTodos, ...pintiaTodos].sort(
    (a, b) => todoSortTime(a) - todoSortTime(b)
  );

  if (allTodos.length === 0) {
    console.log("没有待完成的作业！");
    return;
  }

  console.log(`You have ${allTodos.length} things to do:${allTodos.map((todo) => {
    if (todo.source === "pintia") {
      return `
  - [pintia] ${todo.title} @ ${todo.course_name}
    ${formatDueLine(todo.end_time)}
    Go to https://pintia.cn/problem-sets/${todo.id}/exam/problems to submit it.`;
    }
    if (todo.type === "interaction") {
      return `
  - ${todo.title} @ ${todo.course_name}
    ${formatDueLine(todo.end_time)}
    Go to https://courses.zju.edu.cn/course/${todo.course_id}/content#/ to finish it.`;
    }
    return `
  - ${todo.title} @ ${todo.course_name}
    ${formatDueLine(todo.end_time)}
    Go to https://courses.zju.edu.cn/course/${todo.course_id}/learning-activity#/${todo.id} to submit it.`;
  }).join("\n")}
`);
})();
