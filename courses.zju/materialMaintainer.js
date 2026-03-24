/* 维护学在浙大课件，你需要准备一个`.cache.json`文件，初始为
{
  "root": "D:/path/to/the/courseware/folder", 
  // -- update on 2026/3/18: This `root` field is now optional, if not provided, the script will use the cache file directory as root 
  "xid": "81029",// 课程ID
  "cache": []
}

使用时将该文件路径作为参数传入
*/

const cacheFile = process.argv.find((v) => v.endsWith(".cache.json"));

if (!cacheFile) {
  console.error("Please provide a cache file path as an argument.");  
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));

if (!data.root) {
  const fallbackRoot = path.dirname(path.resolve(cacheFile));
  console.warn(
    `[!] The cache file does not contain \"root\". Use cache directory as root: ${fallbackRoot}`
  );
  data.root = fallbackRoot;
}

data.root = path.resolve(data.root);
if (!fs.existsSync(data.root)) {
  fs.mkdirSync(data.root, { recursive: true });
}



import inquirer from "inquirer";
import { COURSES, ZJUAM } from "login-zju";
import cliProgress from "cli-progress";
import fs from "fs";
import path from "path";

import "dotenv/config";

const courses = new COURSES(
  new ZJUAM(process.env.ZJU_USERNAME, process.env.ZJU_PASSWORD)
);

const byteToSize = (bytes) => {
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  if (bytes == 0) return "0 Byte";
  let i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
  if (i > sizes.length - 1) i = sizes.length - 1;
  return Math.round(bytes / Math.pow(1024, i), 2) + " " + sizes[i];
};

const downloadFiles = (list) => {
  const multibar = new cliProgress.MultiBar(
    {
      clearOnComplete: true,
      hideCursor: true,
      format: "{filename} | {bar} | {value}/{total}",
    },
    cliProgress.Presets.rect
  );
  const download = async (fileinfo) => {
    // console.log(fileinfo,"https://courses.zju.edu.cn/api/uploads/"+fileinfo.id+"/blob");
    
    const response = await courses.fetch("https://courses.zju.edu.cn/api/uploads/"+fileinfo.id+"/blob");

    if (!response.ok) {
      throw new Error(`下载失败: ${response.statusText}`);
    }
    const writer = fs.createWriteStream(path.join(data.root,fileinfo.name));

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
  Promise.all(
    list.map((file) => {
      return new Promise((resolve, reject) => {
        download(file)
          .then(() => {
            multibar.update(file.size, { filename: file.name });
            resolve();
          })
          .catch((err) => {
            console.error(`下载失败: ${err.message}`);
            reject(err);
          });
      });
    })
  )
    .then(() => {
      multibar.stop();
      console.log(`[+] 下载完成`);
      data.cache.push(...list);
      fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
    })
    .catch((err) => {
      console.error(`[x] 下载失败: ${err.message}`);
    });




};

(async () => {
  courses.
    fetch(`https://courses.zju.edu.cn/api/courses/${data.xid}/activities`)
        .then((v) => v.json())
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
      .filter(
        (material) =>
          data.cache.findIndex((v) => v.id === material.id) === -1
      )
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
