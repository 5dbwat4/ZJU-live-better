/* 下载学在浙大课件 */

import inquirer from "inquirer";
import { COURSES, ZJUAM } from "login-zju";
import cliProgress from "cli-progress";
import fs from "fs";
import path from "path";

import "dotenv/config";
import { pickCourseId } from "../shared/choose-a-course.js";
import { byteToSize } from "../shared/utils.js";

const courses = new COURSES(
  new ZJUAM(process.env.ZJU_USERNAME, process.env.ZJU_PASSWORD)
);


const downloadFiles = (list) => {
  const multibar = new cliProgress.MultiBar(
    {
      clearOnComplete: true,
      hideCursor: true,
      format: "{filename} | {bar} | {value}/{total}",
    },
    cliProgress.Presets.shades_grey
  );
  const download = async (fileinfo) => {
    console.log(fileinfo,"https://courses.zju.edu.cn/api/uploads/"+fileinfo.id+"/blob");
    
    const response = await courses.fetch("https://courses.zju.edu.cn/api/uploads/"+fileinfo.id+"/blob");

    if (!response.ok) {
      throw new Error(`下载失败: ${response.statusText}`);
    }
    const writer = fs.createWriteStream(fileinfo.name);

    const bar = multibar.create(fileinfo.size, 0, { filename:fileinfo.name });

    let receivedBytes = 0;
    // const totalBytes = parseInt(response.headers.get("content-length"), 10);

    let receivedLength = 0; // received that many bytes at the moment
    let chunks = []; // array of received binary chunks 

    // bar.start(totalBytes, 0);

    // 读取数据流
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
      receivedLength += value.length;
      bar.update(receivedLength);
    }
    // 合并数据流
    writer.write(Buffer.concat(chunks));
    writer.end();

    return new Promise((resolve, reject) => {
      writer.on("finish", resolve).on("error", reject);
    });
  };
  list.forEach((file) => {
    const filename = file.name.replace(/[\\/:*?"<>|]/g, "_");
    // multibar.create(file.size, 0, { filename });
    download(file).then(()=>{
      // fs.appendFileSync(path.resolve(process.cwd(), ".learninginzju-materials"), file.id + "\n")
    })
  });


};

(async () => {
 pickCourseId(courses)
    .then(async ( courseId ) => {
      // console.log(course);

      return courses
        .fetch(`https://courses.zju.edu.cn/api/courses/${courseId}/activities`)
        .then((v) => v.json());
    })
    .then(({ activities }) => {
      const materialList = activities.filter(
        (activity) => activity.type === "material"
      );
      let realMaterialList = [];
      materialList.forEach((material) => {
        material.uploads.forEach((upload) => {
          realMaterialList.push({
            name: upload.name,
            key: upload.key,
            id: upload.id,
            size: upload.size,
            created_at: upload.created_at,
          });
        });
      });
      return realMaterialList
      // .filter(v=>!(fs.readFileSync(path.resolve(process.cwd(), ".learninginzju-materials")).toString().split("\n").includes(v.id)))
    })
    .then((materialList) => {
      return inquirer
        .prompt({
          type: "confirm",
          name: "whether",
          message: `Will download ${
            materialList.length
          } materials, size ${byteToSize(
            materialList.reduce((acc, cur) =>(acc + cur.size), 0)
          )}, continue?`,
          default: true,
        })
        .then(({ whether }) => {
          if (whether) {
            downloadFiles(materialList);
          }
        });
    });
})();
