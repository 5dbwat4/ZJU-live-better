#!/usr/bin/env node

import crypto from "crypto";
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { ZJUAM } from "login-zju";

import {
  buildDefaultAnswers,
  createZdbkClient,
  decodeJwtPayload,
  fetchEvaluationBootstrapUrl,
  getCredentials,
  summarizeSchema,
} from "./evaluationAutomation.js";

const ALT_BASE_URL = "https://alt.zju.edu.cn";
const ALT_APP_CODE = "11";
const DEFAULT_TARGET = "/studentEvaluationBackend/list?appCode=11";

function parseArgs(argv) {
  const args = {
    submit: false,
    all: false,
    courseId: null,
    teacherSid: null,
    pageNum: 0,
    pageSize: 20,
    json: false,
    praise: null,
    suggestion: null,
    interactive: argv.length === 0,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === "--submit") {
      args.submit = true;
      continue;
    }
    if (current === "--json") {
      args.json = true;
      continue;
    }
    if (current === "--all") {
      args.all = true;
      args.submit = true;
      continue;
    }
    if (current === "--interactive") {
      args.interactive = true;
      continue;
    }
    if (current === "--no-interactive") {
      args.interactive = false;
      continue;
    }
    if (current === "--course-id") {
      args.courseId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (current === "--teacher-sid") {
      args.teacherSid = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (current === "--page-num") {
      args.pageNum = Number(argv[index + 1] ?? 0);
      index += 1;
      continue;
    }
    if (current === "--page-size") {
      args.pageSize = Number(argv[index + 1] ?? 20);
      index += 1;
      continue;
    }
    if (current === "--praise") {
      args.praise = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (current === "--suggestion") {
      args.suggestion = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
  }

  return args;
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function md5Hex(text) {
  return crypto.createHash("md5").update(text).digest("hex");
}

function randomAlphaNumeric(length = 16) {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const buffer = crypto.randomBytes(length);
  return Array.from(buffer, (value) => alphabet[value % alphabet.length]).join("");
}

function signAltRequest(pathname, bodyString, rand, timestamp) {
  const bodyHash = sha256Hex(bodyString);
  return md5Hex(
    `$4holys**t${ALT_APP_CODE}${bodyHash}${rand.substring(3, 11)}${timestamp}${pathname}`
  );
}

function buildSignedRequest(pathname, body, token) {
  const bodyString = JSON.stringify(body ?? {});
  const rand = randomAlphaNumeric(16);
  const timestamp = Date.now().toString();

  return {
    bodyString,
    headers: {
      Accept: "application/json, text/plain, */*",
      Authorization: `Bearer ${token}`,
      "App-Code": ALT_APP_CODE,
      "Content-Type": "application/json;charset=UTF-8",
      platform: "WEB",
      "X-BD": rand,
      "X-QW": signAltRequest(pathname, bodyString, rand, timestamp),
      "X-XW": timestamp,
    },
  };
}

async function resolveAltToken(am, targetPath = DEFAULT_TARGET) {
  await am.login();

  let currentUrl = await am.loginSvc(
    `${ALT_BASE_URL}/ua/login?platform=WEB&target=${encodeURIComponent(targetPath)}`
  );

  for (let hop = 0; hop < 10; hop += 1) {
    const response = await am.fetch(currentUrl, { method: "GET", redirect: "manual" });
    const location = response.headers.get("location");

    if (response.status >= 300 && response.status < 400 && location) {
      currentUrl = location;
      continue;
    }

    const text = await response.text();
    const refreshMatch = text.match(/meta http-equiv="refresh" content="0;URL=([^"]+)"/i);
    if (refreshMatch) {
      currentUrl = refreshMatch[1];
      continue;
    }

    break;
  }

  const finalUrl = new URL(currentUrl);
  const token = finalUrl.searchParams.get("token");
  if (!token) {
    throw new Error(`Failed to resolve alt token from URL: ${finalUrl.toString()}`);
  }

  return {
    token,
    finalUrl: finalUrl.toString(),
  };
}

async function callAltApi(am, pathname, body, token) {
  const { bodyString, headers } = buildSignedRequest(pathname, body, token);
  const response = await am.fetch(`${ALT_BASE_URL}${pathname}`, {
    method: "POST",
    headers,
    body: bodyString,
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON from ${pathname}: ${text.slice(0, 300)}`);
  }

  if (!response.ok) {
    throw new Error(`${pathname} failed with HTTP ${response.status}: ${text}`);
  }

  if (payload?.code !== 200) {
    throw new Error(`${pathname} returned code ${payload?.code}: ${payload?.msg}`);
  }

  return payload;
}

function pickTodoCourse(todoPayload, preferredCourseId) {
  const courses = todoPayload?.data?.data ?? [];
  if (preferredCourseId) {
    const match = courses.find((course) => course.id === preferredCourseId);
    if (!match) {
      throw new Error(`Course ${preferredCourseId} not found in current todo list`);
    }
    return match;
  }

  return courses[0] ?? null;
}

function getTodoCourses(todoPayload) {
  return todoPayload?.data?.data ?? [];
}

function pickTeachers(detail, preferredTeacherSid) {
  const teachers = detail?.teacherList ?? [];
  if (preferredTeacherSid) {
    const match = teachers.find((teacher) => teacher.userSid === preferredTeacherSid);
    if (!match) {
      throw new Error(`Teacher ${preferredTeacherSid} not found in evaluation task`);
    }
    return [match];
  }

  const seen = new Set();
  return teachers.filter((teacher) => {
    const key = [
      teacher?.userSid ?? "",
      normalizeFormId(teacher?.formId) ?? "",
      teacher?.teacherName ?? teacher?.userName ?? "",
    ].join("::");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function normalizeFormId(formId) {
  if (!formId) return null;
  if (typeof formId === "string") return formId;
  return formId.id ?? null;
}

function buildSubmissionPlan(todoCourse, detail, teacher, answers) {
  const currentFormId = normalizeFormId(teacher?.formId);

  if (currentFormId) {
    return {
      mode: "update",
      updateDocument: {
        id: currentFormId,
        value: answers,
      },
    };
  }

  return {
    mode: "insert",
    insertDocument: {
      groupId: detail.groupId,
      value: answers,
    },
    savePlanCourse: {
      planCourseId: todoCourse.id,
      teaching: Boolean(teacher?.teaching),
      formId: null,
      teaSid: teacher?.userSid ?? null,
    },
  };
}

function buildTeacherReports(todoCourse, detail, teachers, answers) {
  return teachers.map((teacher) => ({
    teacher,
    submissionPlan: buildSubmissionPlan(todoCourse, detail, teacher, answers),
  }));
}

function printSummary(report) {
  console.log(`Mode: ${report.submit ? "submit" : "dry-run"}`);
  console.log(`Alt entry: ${report.alt.finalUrl}`);
  console.log(`JWT loginName: ${report.alt.tokenPayload?.loginName ?? "unknown"}`);
  console.log(`JWT sid: ${report.alt.tokenPayload?.sid ?? "unknown"}`);
  console.log(
    `Todo course: ${report.todoCourse?.courseName ?? "none"} (${report.todoCourse?.id ?? "none"})`
  );
  console.log(
    `Teachers: ${report.teacherReports.map(
      ({ teacher }) => teacher?.teacherName ?? teacher?.userName ?? "unknown"
    ).join(", ")}`
  );
  console.log(`groupId: ${report.detail?.groupId ?? "unknown"}`);
  console.log(`Schema fields: ${report.schemaSummary.length}`);
  console.log(
    `Submission modes: ${report.teacherReports
      .map(
        ({ teacher, submissionPlan }) =>
          `${teacher?.teacherName ?? teacher?.userName ?? "unknown"}=${submissionPlan.mode}`
      )
      .join(", ")}`
  );
}

function printCourseList(courses) {
  console.log("");
  console.log(`Pending courses: ${courses.length}`);

  courses.forEach((course, index) => {
    const name = course.courseName ?? "unknown";
    const teacher = course.teacherName ?? course.userName ?? "unknown";
    const id = course.id ?? "unknown";
    console.log(`${index + 1}. ${name} | ${teacher} | ${id}`);
  });
}

async function fetchAllTodoCourses(am, token, initialPageNum = 0, pageSize = 50) {
  const allCourses = [];
  let pageNum = initialPageNum;
  let total = null;

  while (true) {
    const payload = await callAltApi(
      am,
      "/dapi/v2/tes/evaluation_plan_service/page_my_todo_plan_course_list",
      { pageNum, pageSize },
      token
    );

    const pageCourses = getTodoCourses(payload);
    const pageTotal = Number(payload?.data?.total ?? payload?.data?.recordsTotal ?? NaN);
    if (Number.isFinite(pageTotal)) {
      total = pageTotal;
    }

    allCourses.push(...pageCourses);

    if (pageCourses.length === 0) {
      break;
    }

    if (total !== null && allCourses.length >= total) {
      break;
    }

    if (pageCourses.length < pageSize) {
      break;
    }

    pageNum += 1;
  }

  return allCourses;
}

async function buildCourseReport(am, alt, tokenPayload, todoCourse, args) {
  const detailPayload = await callAltApi(
    am,
    "/dapi/v2/tes/evaluation_plan_service/find_plan_courses_by_user",
    {
      planCourseId: todoCourse.id,
    },
    alt.token
  );

  const detail = detailPayload.data;
  const teachers = pickTeachers(detail, args.teacherSid);
  if (teachers.length === 0) {
    throw new Error(`No teacher found in evaluation task for ${todoCourse.courseName ?? todoCourse.id}`);
  }

  const schemaPayload = await callAltApi(
    am,
    "/dapi/v2/autoform/schema_service/find_schema_by_group",
    {
      groupId: detail.groupId,
    },
    alt.token
  );

  const schema = schemaPayload.data.schema;
  const answers = buildDefaultAnswers(schema, {
    praise: args.praise ?? undefined,
    suggestion: args.suggestion ?? undefined,
  });
  const teacherReports = buildTeacherReports(todoCourse, detail, teachers, answers);

  return {
    submit: args.submit,
    alt: {
      finalUrl: alt.finalUrl,
      tokenPayload,
    },
    todoCourse,
    detail,
    teacher: teacherReports[0]?.teacher ?? null,
    schemaSummary: summarizeSchema(schema),
    answers,
    submissionPlan: teacherReports[0]?.submissionPlan ?? null,
    teacherReports,
  };
}

async function submitCourseReport(am, alt, report) {
  report.teacherResults = [];

  for (const teacherReport of report.teacherReports) {
    const { teacher, submissionPlan } = teacherReport;

    if (submissionPlan.mode === "insert") {
      const insertPayload = await callAltApi(
        am,
        "/dapi/v2/autoform/document_service/insert_document",
        submissionPlan.insertDocument,
        alt.token
      );
      const insertedId =
        (typeof insertPayload?.data === "string" ? insertPayload.data : null) ??
        insertPayload?.data?.id ??
        insertPayload?.data?._id ??
        insertPayload?.data?.documentId ??
        insertPayload?.data?.formId ??
        insertPayload?.data?.insertedId ??
        null;
      if (!insertedId) {
        throw new Error(
          `insert_document succeeded but no document id returned: ${JSON.stringify(insertPayload?.data)}`
        );
      }

      submissionPlan.savePlanCourse.formId = insertedId;
      const saveResult = (
        await callAltApi(
          am,
          "/dapi/v2/tes/evaluation_plan_service/save_plan_courses_by_user",
          submissionPlan.savePlanCourse,
          alt.token
        )
      ).data;

      teacherReport.insertResult = insertPayload.data;
      teacherReport.saveResult = saveResult;
      report.teacherResults.push({
        teacherName: teacher?.teacherName ?? teacher?.userName ?? null,
        teacherSid: teacher?.userSid ?? null,
        mode: submissionPlan.mode,
        insertResult: insertPayload.data,
        saveResult,
      });
      continue;
    }

    const updateResult = (
      await callAltApi(
        am,
        "/dapi/v2/autoform/document_service/update_document",
        submissionPlan.updateDocument,
        alt.token
      )
    ).data;

    teacherReport.updateResult = updateResult;
    report.teacherResults.push({
      teacherName: teacher?.teacherName ?? teacher?.userName ?? null,
      teacherSid: teacher?.userSid ?? null,
      mode: submissionPlan.mode,
      updateResult,
    });
  }

  return report;
}

async function runInteractiveMode(am, alt, tokenPayload, args) {
  const courses = await fetchAllTodoCourses(am, alt.token, args.pageNum, Math.max(args.pageSize, 50));

  if (courses.length === 0) {
    console.log("No pending evaluation course found");
    return;
  }

  printCourseList(courses);
  console.log("");
  console.log("Input a course number to submit one course, `all` to submit all, or press Enter to exit.");

  const rl = createInterface({ input, output });

  try {
    const answer = (await rl.question("> ")).trim().toLowerCase();

    if (!answer) {
      console.log("Exited without submitting.");
      return;
    }

    const selectedCourses =
      answer === "all"
        ? courses
        : (() => {
            const index = Number(answer);
            if (!Number.isInteger(index) || index < 1 || index > courses.length) {
              throw new Error(`Invalid selection: ${answer}`);
            }
            return [courses[index - 1]];
          })();

    const confirmText =
      selectedCourses.length === 1
        ? `Submit evaluation for "${selectedCourses[0].courseName}"? (y/N) `
        : `Submit all ${selectedCourses.length} pending courses? (y/N) `;

    const confirmed = (await rl.question(confirmText)).trim().toLowerCase();
    if (!["y", "yes"].includes(confirmed)) {
      console.log("Cancelled.");
      return;
    }

    const results = [];
    for (const course of selectedCourses) {
      console.log("");
      console.log(`Processing ${course.courseName ?? course.id}...`);
      const report = await buildCourseReport(am, alt, tokenPayload, course, {
        ...args,
        submit: true,
      });
      await submitCourseReport(am, alt, report);
      results.push(report);
      console.log(`Submitted ${course.courseName ?? course.id}`);
    }

    console.log("");
    console.log(`Completed ${results.length} course(s).`);
  } finally {
    rl.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { username: account, password } = getCredentials();
  const am = new ZJUAM(account, password);
  const alt = await resolveAltToken(am);
  const tokenPayload = decodeJwtPayload(alt.token);

  if (args.interactive && !args.json && !args.courseId && !args.teacherSid && !args.all) {
    await runInteractiveMode(am, alt, tokenPayload, args);
    return;
  }

  if (args.all) {
    const courses = await fetchAllTodoCourses(am, alt.token, args.pageNum, Math.max(args.pageSize, 50));
    if (courses.length === 0) {
      throw new Error("No pending evaluation course found");
    }

    const results = [];
    for (const course of courses) {
      const report = await buildCourseReport(am, alt, tokenPayload, course, args);
      await submitCourseReport(am, alt, report);
      results.push({
        courseId: report.todoCourse?.id ?? null,
        courseName: report.todoCourse?.courseName ?? null,
        teachers:
          report.teacherResults?.map((item) => ({
            teacherName: item.teacherName,
            teacherSid: item.teacherSid,
            mode: item.mode,
          })) ?? [],
      });
    }

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            submit: true,
            all: true,
            total: results.length,
            results,
          },
          null,
          2
        )
      );
      return;
    }

    printCourseList(courses);
    console.log("");
    console.log(`Completed ${results.length} course(s).`);
    return;
  }

  const todoPayload = await callAltApi(
    am,
    "/dapi/v2/tes/evaluation_plan_service/page_my_todo_plan_course_list",
    {
      pageNum: args.pageNum,
      pageSize: args.pageSize,
    },
    alt.token
  );

  const todoCourse = pickTodoCourse(todoPayload, args.courseId);
  if (!todoCourse) {
    throw new Error("No pending evaluation course found");
  }
  const report = await buildCourseReport(am, alt, tokenPayload, todoCourse, args);

  if (!args.submit) {
    const { username } = getCredentials();
    const { zdbk } = createZdbkClient();
    report.bootstrapUrl = await fetchEvaluationBootstrapUrl(zdbk, username);
  }

  if (args.submit) {
    await submitCourseReport(am, alt, report);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printSummary(report);

  if (!args.submit) {
    console.log("");
    console.log("insert_document preview:");
    for (const teacherReport of report.teacherReports) {
      const teacherName =
        teacherReport.teacher?.teacherName ?? teacherReport.teacher?.userName ?? "unknown";
      console.log("");
      console.log(`[${teacherName}]`);
      console.log(
        JSON.stringify(
          teacherReport.submissionPlan.insertDocument ?? teacherReport.submissionPlan.updateDocument,
          null,
          2
        )
      );
      if (teacherReport.submissionPlan.savePlanCourse) {
        console.log("");
        console.log("save_plan_courses_by_user preview:");
        console.log(JSON.stringify(teacherReport.submissionPlan.savePlanCourse, null, 2));
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
