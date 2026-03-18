/*
获取智云课堂课程视频链接并用你喜欢的播放器打开。

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

import "dotenv/config";
let opener = process.env.VIDEO_OPENER??false;
import { spawn } from "child_process";


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
    .then(async (choices) => {
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
      }else{
        return {id};
      }
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
  return inquirer
    .prompt({
      type: "list",
      name: "video",
      message: "Choose the video:",
      choices,
    })
    .then(({ video }) => {
      return JSON.parse(video.content).playback.url;
    })
    .then((url) => {
      console.log("Video URL:");
      console.log(url);
      return inquirer
        .prompt({
          type: "confirm",
          name: "confirm",
          message: "Send the video URL to your video player?",
          default: true,
        })
        .then(async(confirm) => {
          if (confirm.confirm) {
            // const { spawn } = require("child_process");
            if(!opener){
              console.log("VIDEO_OPENER is not set in .env file!");
              opener = await inquirer.prompt({
                type: "input",
                name: "path",
                message: "Please input the path of your video player:",
              }).then(ans=>ans.path);
            }
            const potplayer = spawn(opener, [url]);
            potplayer.on("close", (code) => {
              console.log(`child process exited with code ${code}`);
              ChooseVideo(choices);
            });
          }
        });
    });
}
