import inquirer from "inquirer";
import { CLASSROOM, ZJUAM } from "login-zju";

import "dotenv/config";
import { spawn } from "child_process";

const defaultPlayerCommand =
  process.env.MEDIA_PLAYER_CMD ||
  (process.platform === "win32"
    ? "D:\\Developing_Environment\\Programs\\PotPlayer\\PotPlayerMini64.exe"
    : "open");

const defaultPlayerArgs = process.env.MEDIA_PLAYER_ARGS
  ? process.env.MEDIA_PLAYER_ARGS.split(" ").filter((segment) => segment.length > 0)
  : [];

const playerInfo = {
  command: defaultPlayerCommand,
  args: defaultPlayerArgs,
};


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
    .then((choices) => {
      return inquirer.prompt({
        type: "list",
        name: "id",
        message: "Choose the course:",
        loop: true,
        choices,
      });
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
          message: "Send the video URL to PotPlayer?",
          default: true,
        })
        .then((confirm) => {
          if (confirm.confirm) {
            if (!playerInfo.command) {
              console.log(
                "Player command not configured. Set MEDIA_PLAYER_CMD to enable auto playback."
              );
              return;
            }

            const potplayer = spawn(playerInfo.command, [...playerInfo.args, url], {
              stdio: "ignore",
            });

            potplayer.on("error", (error) => {
              console.error("Failed to launch player:", error.message);
            });

            potplayer.on("close", (code) => {
              console.log(`child process exited with code ${code}`);
              ChooseVideo(choices);
            });
          }
        });
    });
}
