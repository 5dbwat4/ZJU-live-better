/*
获取智云课堂课程视频链接并用你喜欢的播放器打开。
或批量保存视频URL到JSON文件。

使用前在.env文件中追加：
```
VIDEO_OPENER=your video player path
```
示例：
```
VIDEO_OPENER="D:\\Developing_Environment\\Programs\\PotPlayer\\PotPlayerMini64.exe"
```
*/


import inquirer from "inquirer";
import { CLASSROOM, ZJUAM } from "login-zju";
import fs from "fs";
import path from "path";

import "dotenv/config";
let opener = process.env.VIDEO_OPENER??false;
import { spawn } from "child_process";


const classroom = new CLASSROOM(
  new ZJUAM(process.env.ZJU_USERNAME, process.env.ZJU_PASSWORD)
);

const JSON_FILE_PATH = path.join("downloads", "CourseVideoURL.json");

// 读取或初始化JSON文件
function loadVideoData() {
  try {
    if (fs.existsSync(JSON_FILE_PATH)) {
      const data = fs.readFileSync(JSON_FILE_PATH, "utf8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Error loading JSON file:", error);
  }
  return { courses: {} };
}

// 保存数据到JSON文件
function saveVideoData(data) {
  try {
    const dir = path.dirname(JSON_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(JSON_FILE_PATH, JSON.stringify(data, null, 2), "utf8");
    console.log(`\n✓ Data saved to ${JSON_FILE_PATH}\n`);
  } catch (error) {
    console.error("Error saving JSON file:", error);
  }
}

const TimeAgo = (time) => {
  const now = new Date().getTime();
  const diff = (now - time * 1000) / 1000;

  if (diff < 60) {
    return "just now";
  } else if (diff < 60 * 60) {
    return Math.floor(diff / 60) + " minutes ago";
  } else if (diff < 60 * 60 * 24) {
    return Math.floor(diff / (60 * 60)) + " hours ago";
  } else if (diff < 60 * 60 * 24 * 30) {
    return Math.floor(diff / (60 * 60 * 24)) + " days ago";
  } else if (diff < 60 * 60 * 24 * 365) {
    return Math.floor(diff / (60 * 60 * 24 * 30)) + " months ago";
  } else {
    return Math.floor(diff / (60 * 60 * 24 * 365)) + " years ago";
  }
};

async function main() {
  // 选择模式
  const { mode } = await inquirer.prompt({
    type: "list",
    name: "mode",
    message: "Choose mode:",
    choices: [
      { name: "Play mode (open videos in player)", value: "play" },
      { name: "Batch save mode (save URLs to JSON)", value: "batch" },
    ],
  });

  const isBatchMode = mode === "batch";

  while (true) {
    try {
      const coursesData = await classroom
        .fetch(
          "https://education.cmc.zju.edu.cn/personal/courseapi/vlabpassportapi/v1/account-profile/course?nowpage=1&per-page=100&force_mycourse=1"
        )
        .then((v) => v.json())
        .then((res) => {
          const data = res.params.result.data;
          return data.map((c) => ({
            Id: c.Id,
            Title: c.Title,
            Teacher: c.Teacher,
          }));
        });

      if (isBatchMode) {
        await batchSaveMode(coursesData);
      } else {
        await playMode(coursesData);
      }
    } catch (error) {
      console.error("Error:", error);
      const { retry } = await inquirer.prompt({
        type: "confirm",
        name: "retry",
        message: "An error occurred. Do you want to retry?",
        default: true,
      });
      if (!retry) {
        break;
      }
    }
  }
}

// 播放模式（原有逻辑）
async function playMode(coursesData) {
  const choices = coursesData.map((c) => ({
    value: c.Id,
    name: c.Title + " - " + c.Teacher,
  }));

  const { id } = await inquirer.prompt({
    type: "list",
    name: "id",
    message: "Choose the course:",
    loop: true,
    choices,
  });

  const courseInfo = coursesData.find((c) => c.Id === id);
  const data = await classroom
    .fetch(
      "https://yjapi.cmc.zju.edu.cn/courseapi/v2/course/catalogue?course_id=" +
        id
    )
    .then((v) => v.json());

  const vlist = data.result.data;
  const videoChoices = vlist
    .filter((v) => v.status === "6")
    .sort((a, b) => Number(b.start_at) - Number(a.start_at))
    .map((vd) => ({
      value: vd,
      name: vd.title + " (" + TimeAgo(Number(vd.start_at)) + ")",
    }));

  await ChooseVideo(videoChoices, false);
}

// 批量保存模式
async function batchSaveMode(coursesData) {
  const { batchType } = await inquirer.prompt({
    type: "list",
    name: "batchType",
    message: "How do you want to select videos?",
    choices: [
      { name: "Select entire courses", value: "courses" },
      { name: "Select videos one by one", value: "videos" },
    ],
  });

  if (batchType === "courses") {
    await batchSaveByCourses(coursesData);
  } else {
    await batchSaveByVideos(coursesData);
  }
}

// 按课程批量保存
async function batchSaveByCourses(coursesData) {
  const choices = coursesData.map((c) => ({
    value: c.Id,
    name: c.Title + " - " + c.Teacher,
    courseInfo: c,
  }));

  const { selectedCourses } = await inquirer.prompt({
    type: "checkbox",
    name: "selectedCourses",
    message: "Select courses to save (use space to select, enter to confirm):",
    choices: choices,
    loop: false,
  });

  if (selectedCourses.length === 0) {
    console.log("\n⚠ 未选择任何课程。\n");
    await promptNextAction();
    return;
  }

  const videoData = loadVideoData();
  const courseResults = [];

  for (const courseId of selectedCourses) {
    const courseInfo = coursesData.find((c) => c.Id === courseId);
    const courseName = `${courseInfo.Title} - ${courseInfo.Teacher}`;

    console.log(`\n正在获取《${courseName}》的视频...`);

    const data = await classroom
      .fetch(
        "https://yjapi.cmc.zju.edu.cn/courseapi/v2/course/catalogue?course_id=" +
          courseId
      )
      .then((v) => v.json());

    const vlist = data.result.data
      .filter((v) => v.status === "6")
      .sort((a, b) => Number(b.start_at) - Number(a.start_at));

    if (!videoData.courses[courseName]) {
      videoData.courses[courseName] = {
        courseId: courseId,
        teacher: courseInfo.Teacher,
        videos: [],
      };
    }

    let addedCount = 0;
    for (const video of vlist) {
      const url = JSON.parse(video.content).playback.url;
      const videoInfo = {
        title: video.title,
        url: url,
        timestamp: Number(video.start_at),
        date: new Date(Number(video.start_at) * 1000).toLocaleString("zh-CN"),
        addedAt: new Date().toISOString(),
      };

      // 检查是否已存在
      const exists = videoData.courses[courseName].videos.some(
        (v) => v.url === url
      );
      if (!exists) {
        videoData.courses[courseName].videos.push(videoInfo);
        addedCount++;
      }
    }

    courseResults.push({
      courseName,
      videoCount: addedCount,
    });

    console.log(`  ✓ 已添加 ${addedCount} 个视频`);
  }

  saveVideoData(videoData);
  console.log("\n=== 保存完成 ===");
  courseResults.forEach(({ courseName, videoCount }) => {
    console.log(`  ✓ ${courseName}: ${videoCount} 个视频`);
  });
  console.log(`\n总共保存了 ${courseResults.reduce((sum, c) => sum + c.videoCount, 0)} 个视频\n`);

  await promptNextAction();
}

// 按视频逐个选择并保存
async function batchSaveByVideos(coursesData) {
  const videoData = loadVideoData();
  const selectedCoursesInfo = []; // 记录选择的课程信息

  while (true) {
    const choices = coursesData.map((c) => ({
      value: c.Id,
      name: c.Title + " - " + c.Teacher,
    }));

    // 添加"完成并保存"选项
    choices.push({
      value: "__FINISH__",
      name: "────────────────────────────",
    });
    choices.push({
      value: "__FINISH__",
      name: "✓ Finish and Save (按 Enter 保存)",
    });

    const { id } = await inquirer.prompt({
      type: "list",
      name: "id",
      message: selectedCoursesInfo.length > 0 
        ? `已选择 ${selectedCoursesInfo.length} 门课程，继续选择或完成:`
        : "Choose the course:",
      loop: true,
      choices,
    });

    // 如果选择完成
    if (id === "__FINISH__") {
      if (selectedCoursesInfo.length === 0) {
        console.log("\n⚠ 未选择任何课程。\n");
        return;
      }
      break;
    }

    const courseInfo = coursesData.find((c) => c.Id === id);
    const courseName = `${courseInfo.Title} - ${courseInfo.Teacher}`;

    const data = await classroom
      .fetch(
        "https://yjapi.cmc.zju.edu.cn/courseapi/v2/course/catalogue?course_id=" +
          id
      )
      .then((v) => v.json());

    const vlist = data.result.data
      .filter((v) => v.status === "6")
      .sort((a, b) => Number(b.start_at) - Number(a.start_at));

    const videoChoices = vlist.map((vd) => ({
      value: vd,
      name: vd.title + " (" + TimeAgo(Number(vd.start_at)) + ")",
    }));

    const { selectedVideos } = await inquirer.prompt({
      type: "checkbox",
      name: "selectedVideos",
      message: "Select videos to save (use space to select, enter to confirm):",
      choices: videoChoices,
      loop: false,
    });

    if (selectedVideos.length === 0) {
      console.log("⚠ 未选择任何视频，跳过该课程。\n");
      continue;
    }

    // 暂存到内存，稍后一起保存
    if (!videoData.courses[courseName]) {
      videoData.courses[courseName] = {
        courseId: id,
        teacher: courseInfo.Teacher,
        videos: [],
      };
    }

    let addedCount = 0;
    for (const video of selectedVideos) {
      const url = JSON.parse(video.content).playback.url;
      const videoInfo = {
        title: video.title,
        url: url,
        timestamp: Number(video.start_at),
        date: new Date(Number(video.start_at) * 1000).toLocaleString("zh-CN"),
        addedAt: new Date().toISOString(),
      };

      // 检查是否已存在
      const exists = videoData.courses[courseName].videos.some(
        (v) => v.url === url
      );
      if (!exists) {
        videoData.courses[courseName].videos.push(videoInfo);
        addedCount++;
      }
    }

    selectedCoursesInfo.push({
      courseName,
      videoCount: addedCount,
    });

    console.log(`\n✓ 已选择《${courseName}》的 ${addedCount} 个视频\n`);
  }

  // 统一保存所有选择
  saveVideoData(videoData);
  console.log("\n=== 保存完成 ===");
  selectedCoursesInfo.forEach(({ courseName, videoCount }) => {
    console.log(`  ✓ ${courseName}: ${videoCount} 个视频`);
  });
  console.log(`\n总共保存了 ${selectedCoursesInfo.reduce((sum, c) => sum + c.videoCount, 0)} 个视频\n`);
  console.log(`文件保存在: ${JSON_FILE_PATH}\n`);

  await promptNextAction();
}

// 询问下一步操作
async function promptNextAction() {
  const { nextAction } = await inquirer.prompt({
    type: "list",
    name: "nextAction",
    message: "What would you like to do next?",
    choices: [
      { name: "Continue", value: "continue" },
      { name: "Exit", value: "exit" },
    ],
  });

  if (nextAction === "exit") {
    process.exit(0);
  }
}

main();

async function ChooseVideo(choices, isBatchMode = false) {
  while (true) {
    const { video } = await inquirer.prompt({
      type: "list",
      name: "video",
      message: "Choose the video:",
      choices,
    });

    const url = JSON.parse(video.content).playback.url;
    console.log("\nVideo URL:");
    console.log(url);
    console.log();

    if (!isBatchMode) {
      const { confirm } = await inquirer.prompt({
        type: "confirm",
        name: "confirm",
        message: "Send the video URL to your video player?",
        default: true,
      });

      if (confirm) {
        if (!opener) {
          console.log("VIDEO_OPENER is not set in .env file!");
          const ans = await inquirer.prompt({
            type: "input",
            name: "path",
            message: "Please input the path of your video player:",
          });
          opener = ans.path;
        }
        
        await new Promise((resolve) => {
          const potplayer = spawn(opener, [url]);
          potplayer.on("close", (code) => {
            console.log(`\nVideo player exited with code ${code}\n`);
            resolve();
          });
        });
      }
    }

    // 询问用户下一步操作
    const { nextAction } = await inquirer.prompt({
      type: "list",
      name: "nextAction",
      message: "What would you like to do next?",
      choices: [
        { name: "Choose another video from this course", value: "video" },
        { name: "Choose another course", value: "course" },
        { name: "Exit", value: "exit" },
      ],
    });

    if (nextAction === "video") {
      continue; // 继续当前循环，重新选择视频
    } else if (nextAction === "course") {
      return; // 返回上一级，重新选择课程
    } else {
      process.exit(0); // 退出程序
    }
  }
}
