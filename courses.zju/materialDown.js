/* 下载学在浙大课件 */

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

const sanitizeFileName = (name) =>
  name
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "") || "unnamed";

const downloadFiles = (list, courseName) => {
  const downloadDir = path.resolve(
    process.cwd(),
    "downloads",
    sanitizeFileName(courseName)
  );
  fs.mkdirSync(downloadDir, { recursive: true });
  console.log(`Materials will be saved to: ${downloadDir}`);

  const multibar = new cliProgress.MultiBar(
    {
      clearOnComplete: true,
      hideCursor: true,
      format: "{filename} | {bar} | {value}/{total}",
    },
    cliProgress.Presets.shades_grey
  );
  const download = async (fileinfo) => {
    const url = `https://courses.zju.edu.cn/api/uploads/${fileinfo.id}/blob`;
    console.log(fileinfo, url);
    
    const response = await courses.fetch(url);

    if (!response.ok) {
      throw new Error(`下载失败: ${response.statusText}`);
    }
    const filename = sanitizeFileName(fileinfo.name);
    const writer = fs.createWriteStream(path.join(downloadDir, filename));

    const bar = multibar.create(fileinfo.size, 0, { filename });

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
    // multibar.create(file.size, 0, { filename });
    download(file).then(()=>{
      // fs.appendFileSync(path.resolve(process.cwd(), ".learninginzju-materials"), file.id + "\n")
    })
  });


};

(async () => {
  courses
    .fetch(
      "https://courses.zju.edu.cn/api/my-semesters?fields=id,name,sort,is_active,code"
    )
    .then((v) => v.json())
    .then(({ semesters }) => {
      return semesters.filter((semester) => semester.is_active);
    })
    .then(async (semesters) => {
      // console.log(semesters);
      const coursesFetchParam = new URLSearchParams();
      coursesFetchParam.set("page", "1");
      coursesFetchParam.set("page_size", "1000");
      coursesFetchParam.set("sort", "all");
      coursesFetchParam.set("normal", '{"version":7,"apiVersion":"1.1.0"}');
      coursesFetchParam.set(
        "conditions",
        JSON.stringify({
          role: [],
          semester_id: semesters.map((v) => v.id),
          academic_year_id: [],
          status: ["ongoing", "notStarted"],
          course_type: [],
          effectiveness: [],
          published: [],
          display_studio_list: false,
        })
      );
      coursesFetchParam.set(
        "fields",
        "id,org_id,name,second_name,department(id,name),instructors(name),grade(name),klass(name),cover,learning_mode,course_attributes(teaching_class_name,data),public_scope,course_type,course_code,compulsory,credit,second_name"
      );

      //   console.log(coursesFetchParam.toString(),decodeURIComponent(coursesFetchParam.toString()));

      return courses
        .fetch(
          "https://courses.zju.edu.cn/api/my-courses?" +
            coursesFetchParam.toString()
        )
        .then((v) => v.json());
    })
    .then(({ courses }) => {
      return inquirer.prompt({
        type: "list",
        name: "course",
        message: "Choose the course :",
        loop: true,
        choices: courses.map((course) => ({
          name: course.name,
          value: course,
        })),
      });
    })
    .then(async ({ course }) => {
      // console.log(course);

      return courses
        .fetch(`https://courses.zju.edu.cn/api/courses/${course.id}/activities`)
        .then((v) => v.json())
        .then((data) => ({ ...data, courseName: course.name }));
    })
    .then(({ activities, courseName }) => {
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
      return { materialList: realMaterialList, courseName };
      // .filter(v=>!(fs.readFileSync(path.resolve(process.cwd(), ".learninginzju-materials")).toString().split("\n").includes(v.id)))
    })
    .then(({ materialList, courseName }) => {
      return inquirer
        .prompt({
          type: "confirm",
          name: "whether",
          message: `Will download ${
            materialList.length
          } materials, size ${byteToSize(
            materialList.reduce((acc, cur) =>(acc + cur.size), 0)
          )}, save to downloads/${sanitizeFileName(courseName)}, continue?`,
          default: true,
        })
        .then(({ whether }) => {
          if (whether) {
            downloadFiles(materialList, courseName);
          }
        });
    });
})();
