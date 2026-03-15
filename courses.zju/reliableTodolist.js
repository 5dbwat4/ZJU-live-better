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
        { homework_activities },
      ] = await Promise.all([
        courses.fetch(`https://courses.zju.edu.cn/api/courses/${course.id}/activities`).then((r) => r.json()).catch(() => ({ activities: [] })),
        courses.fetch(`https://courses.zju.edu.cn/api/course/${course.id}/homework/submission-status?no-intercept=true`).then((r) => r.json()).catch(() => ({ homework_activities: [] })),
      ]);

      const submittedHomeworkIds = new Set(
        (homework_activities || []).filter((h) => h.status_code === "submitted").map((h) => h.id)
      );

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
    })
  );

  return todos;
}

// pintia.cn

async function getPintiaTodos() {
  if (!process.env.PINTIA_EMAIL || !process.env.PINTIA_PASSWORD) {
    console.error(
      "[pintia] 未配置 PINTIA_EMAIL / PINTIA_PASSWORD，跳过 pintia 作业获取。"
    );
    return [];
  }

  // 用 axios cookieJar 管理 session，手动跟随重定向
  const cookieJar = {};
  const parseCookies = (setCookieHeaders) => {
    if (!setCookieHeaders) return;
    const headers = Array.isArray(setCookieHeaders)
      ? setCookieHeaders
      : [setCookieHeaders];
    for (const header of headers) {
      const [pair] = header.split(";");
      const [name, value] = pair.split("=");
      cookieJar[name.trim()] = value ? value.trim() : "";
    }
  };
  const cookieString = () =>
    Object.entries(cookieJar)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");

  const passportHeaders = {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    Accept: "application/json;charset=UTF-8",
    "Content-Type": "application/json;charset=UTF-8",
    "Accept-Language": "zh-CN",
    "X-Marshmallow": "",
    Origin: "https://pintia.cn",
    Referer: "https://pintia.cn/",
  };

  // 1. 登录 passport.pintia.cn
  const loginResp = await axios.post(
    "https://passport.pintia.cn/api/users/sessions",
    {
      email: process.env.PINTIA_EMAIL,
      password: process.env.PINTIA_PASSWORD,
      rememberMe: true,
    },
    {
      headers: { ...passportHeaders, Cookie: cookieString() },
      validateStatus: () => true,
    }
  );

  if (loginResp.status !== 200) {
    throw new Error(
      `[pintia] 登录失败 (${loginResp.status}): ${JSON.stringify(loginResp.data)}`
    );
  }
  parseCookies(loginResp.headers["set-cookie"]);

  // 2. GET dal-not-redir（获取跨域登录重定向 URL）
  const dalResp = await axios.get(
    "https://passport.pintia.cn/api/login/dal-not-redir?redir=%2F",
    {
      headers: { ...passportHeaders, Cookie: cookieString() },
      validateStatus: () => true,
      maxRedirects: 0,
    }
  );
  parseCookies(dalResp.headers["set-cookie"]);

  const redirectUrl =
    dalResp.data?.location || dalResp.headers?.location;
  if (!redirectUrl) {
    throw new Error("[pintia] 未获取到重定向 URL，登录流程异常");
  }

  // 3. 跟随重定向到 patest.cn（设置 JSESSIONID）
  const islandResp = await axios.get(redirectUrl, {
    headers: {
      ...passportHeaders,
      Cookie: cookieString(),
      Origin: "https://pintia.cn",
    },
    validateStatus: () => true,
    maxRedirects: 5,
  });
  parseCookies(islandResp.headers["set-cookie"]);

  // 4. 获取近期未截止的 problem sets（endAtAfter = 昨天 UTC 0点）
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);
  const filter = JSON.stringify({ endAtAfter: yesterday.toISOString() });

  const psResp = await axios.get("https://pintia.cn/api/problem-sets", {
    params: {
      filter,
      limit: 100,
      order_by: "END_AT",
      asc: true,
    },
    headers: {
      ...passportHeaders,
      Cookie: cookieString(),
      Origin: undefined,
      Referer: "https://pintia.cn/problem-sets/dashboard",
    },
    validateStatus: () => true,
  });

  if (psResp.status !== 200) {
    throw new Error(
      `[pintia] 获取作业列表失败 (${psResp.status}): ${JSON.stringify(psResp.data)}`
    );
  }

  const { problemSets = [] } = psResp.data;
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
    (a, b) => a.end_time - b.end_time
  );

  if (allTodos.length === 0) {
    console.log("没有待完成的作业！");
    return;
  }

  console.log(`You have ${allTodos.length} things to do:${allTodos.map((todo) => {
    if (todo.source === "pintia") {
      return `
  - [pintia] ${todo.title} @ ${todo.course_name}
    Remains ${time_later(todo.end_time)} (DDL ${todo.end_time.toLocaleString()})
    Go to https://pintia.cn/problem-sets/${todo.id}/exam/problems to submit it.`;
    }
    return `
  - ${todo.title} @ ${todo.course_name}
    Remains ${time_later(todo.end_time)} (DDL ${todo.end_time.toLocaleString()})
    Go to https://courses.zju.edu.cn/course/${todo.course_id}/learning-activity#/${todo.id} to submit it.`;
  }).join("\n")}
`);
})();
