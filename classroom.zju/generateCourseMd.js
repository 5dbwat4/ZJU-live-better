/*
下载智云课堂课程字幕+图片，并生成Markdown文件

使用前在.env文件中追加：
```
CLASSROOM_DOWNLOAD_PATH=your download path
```
如果不存在此项，数据将被保存在当前目录下的./downloads文件夹中
*/



import inquirer from "inquirer";
import { CLASSROOM, ZJUAM } from "login-zju";

import "dotenv/config";



const classroom = new CLASSROOM(
  new ZJUAM(process.env.ZJU_USERNAME, process.env.ZJU_PASSWORD)
);

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

(async () => {
  classroom
    .fetch(
      "https://education.cmc.zju.edu.cn/personal/courseapi/vlabpassportapi/v1/account-profile/course?nowpage=1&per-page=100&force_mycourse=1"
    )
    .then((v) => v.json())
    .then((res) => {
      // console.log(res);

      const data = res.params.result.data;

      return data.map((c) => ({
        value: c.Id,
        name: c.Title + " - " + c.Teacher,
      }));
    })
    .then(async(choices) => {
      const {id} = await inquirer.prompt({
        type: "list",
        name: "id",
        message: "Choose the course:",
        loop: true,
        choices:[
          ...choices,
          {
            value: "__manual__",
            name: "Manual input course ID",
          }
        ],
      });
      if(id==="__manual__"){
        return inquirer.prompt({
          type: "input",
          name: "id",
          message: "Please input the course ID:",
        });
      }
      return {id};
    })
    .then(({ id }) => {
      // console.log(id);

      return classroom
        .fetch(
          "https://yjapi.cmc.zju.edu.cn/courseapi/v2/course/catalogue?course_id=" +
            id
        )
        .then((v) => v.json());
    })
    .then((data) => {
      const vlist = data.result.data;
      // console.log(vlist,vlist.filter(v=>v.status==="6"));

      const choices = vlist
        .filter((v) => v.status === "6")
        .sort((a, b) => Number(b.start_at) - Number(a.start_at))
        .map((vd) => ({
          value: vd,
          name: vd.title + " (" + TimeAgo(Number(vd.start_at)) + ")",
        }));
      return ChooseVideo(choices);
    });
})();

async function ChooseVideo(choices) {
  const {course_id,sub_id} = await inquirer
    .prompt({
      type: "list",
      name: "video",
      message: "Choose the video:",
      choices,
    }).then(v=>v.video);
  // console.log(course_id,sub_id);
    const exporter = new CourseExporter(course_id, sub_id, classroom);
  try {
    await exporter.export();
  } catch (e) {
    console.error("Export failed:", e);
  }
  ChooseVideo(choices);

}


import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { pipeline } from "stream";
import { promisify } from "util";



const streamPipeline = promisify(pipeline);


function pad(n) {
  return n.toString().padStart(2, "0");
}

class CourseExporter {
  constructor(courseId, subId, classroomInstance = classroom) {
    this.courseId = courseId;
    this.subId = subId;
    this.outputDir = path.join(
      process.env.CLASSROOM_DOWNLOAD_PATH || "./downloads",
      `course_${courseId}_sub_${subId}`
    );
    this.pptData = [];
    this.subtitleData = [];
    this.headers = {};
    this.classroomInstance = classroomInstance;
  }

  async loadHeaders() {
    }

  async getPptData() {
    const base = "https://classroom.zju.edu.cn/pptnote/v1/schedule/search-ppt";
    let page = 1;
    while (true) {
      const params = new URLSearchParams({
        course_id: String(this.courseId),
        sub_id: String(this.subId),
        page: String(page),
        per_page: "100",
      });
      const res = await this.classroomInstance.fetch(`${base}?${params.toString()}`);
      if (!res.ok) throw new Error(`PPT request failed: ${res.status}`);
      const data = await res.json();
      if (data && data.list && data.list.length) {
        for (const item of data.list) {
          let content = item.content;
          try {
            content = typeof content === "string" ? JSON.parse(content) : content;
          } catch (e) {
            content = {};
          }
          this.pptData.push({
            pptimgurl: content.pptimgurl || "",
            created_sec: Number(item.created_sec || 0),
          });
        }
        page++;
      } else {
        break;
      }
    }
    console.log(`Fetched ${this.pptData.length} PPT entries`);
  }

  async getSubtitleData() {
    const base = "https://yjapi.cmc.zju.edu.cn/courseapi/v3/web-socket/search-trans-result";
    const params = new URLSearchParams({
      sub_id: String(this.subId),
      format: "json",
    });
    const res = await this.classroomInstance.fetch(`${base}?${params.toString()}`);
    if (!res.ok) throw new Error(`Subtitle request failed: ${res.status}`);
    const data = await res.json();
    if (data && Array.isArray(data.list)) {
      for (const item of data.list) {
        if (Array.isArray(item.all_content)) {
          for (const c of item.all_content) {
            this.subtitleData.push({
              BeginSec: Number(c.BeginSec || 0),
              Text: c.Text || "",
            });
          }
        }
      }
    }
    console.log(`Fetched ${this.subtitleData.length} subtitle entries`);
  }

  async downloadImage(url, filename) {
    if (!url) return false;
    try {
      const res = await this.classroomInstance.fetch(url);
      if (!res.ok) throw new Error(`Image request failed: ${res.status}`);
      const dest = path.join(this.outputDir, filename);
      await streamPipeline(res.body, fs.createWriteStream(dest));
      return true;
    } catch (e) {
      console.warn(`Failed to download ${filename}: ${e.message}`);
      return false;
    }
  }

  formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `- [${pad(m)}:${pad(s)}]`;
  }

  async generateMarkdown() {

    await fsPromises.mkdir(this.outputDir, { recursive: true });

    const mdlines = [];
    let subtitleIndex = 0;

    for (let i = 0; i < this.pptData.length; i++) {
      const ppt = this.pptData[i];
      const filename = `ppt_${(i + 1).toString().padStart(3, "0")}.png`;
      const ok = await this.downloadImage(ppt.pptimgurl, filename);
      mdlines.push({line:`- ![](${filename})`,time:ppt.created_sec});
    }
    for (const item of this.subtitleData) {
      mdlines.push({line:`${this.formatTime(item.BeginSec)}${item.Text}`,time:item.BeginSec});
    }
    // console.log(mdlines.sort((a,b)=>a.time-b.time));
    
    const mdContent = mdlines
      .sort((a, b) => a.time - b.time)
      .map((v) => v.line)
      .join("\n");

    const mdPath = path.join(this.outputDir, "course_content.md");
    await fsPromises.writeFile(mdPath, mdContent, "utf-8");
    console.log(`Markdown file generated at ${mdPath}`);
  }

  async export() {
    console.log(`Exporting course ${this.courseId} sub ${this.subId}`);
    await this.loadHeaders();
    await this.getPptData();
    await this.getSubtitleData();
    if (!this.pptData.length && !this.subtitleData.length) {
      console.warn("No data to export");
      return;
    }
    await this.generateMarkdown();
    console.log("Export complete");
  }
}

