/* 获取学在浙大quiz的答案 */

// 注意这里的quiz是【可以通过“互动”进入的那种】，不是能通过PC端进入的exam

import inquirer from "inquirer";
import { COURSES, ZJUAM } from "login-zju";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import "dotenv/config";


const courses = new COURSES(
  new ZJUAM(process.env.ZJU_USERNAME, process.env.ZJU_PASSWORD)
);

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
    .then(async ({ courses: courseList }) => {
      let continueScanning = true;
      while (continueScanning) {
        const { course } = await inquirer.prompt({
          type: "list",
          name: "course",
          message: "Choose the course to find the quiz:",
          loop: true,
          choices: courseList.map((course) => ({
            name: course.name,
            value: course,
          })),
        });

        const { classrooms } = await courses
          .fetch(
            `https://courses.zju.edu.cn/api/courses/${course.id}/classroom-list`
          )
          .then((v) => v.json());

        const quizChoices = classrooms
          .filter((v) => v.status == "start")
          .map((interaction) => ({
            name: interaction.title,
            value: interaction,
          }));

        if (quizChoices.length == 0) {
          console.log("No active quiz found.");
        } else {
          const { classroom } = await inquirer.prompt({
            type: "list",
            name: "classroom",
            message: "Choose the quiz to answer:",
            choices: quizChoices,
          });

          const oral = await courses
            .fetch(
              `https://courses.zju.edu.cn/api/classroom/${classroom.id}/subject`
            )
            .then((v) => v.json());

          oral.subjects.forEach((rv) => {
            if (rv.type != "fill_in_blank") {
              console.log(`Q#${rv.id} -: ${rv.description}`);
              rv.options
                .filter((rx) => rx.is_answer)
                .forEach((ans) => {
                  console.log(
                    `  - Answer: ${String.fromCharCode([65 + ans.sort])}. ${ans.content}`
                  );
                });
            } else {
              console.log(`Q#${rv.id} -: ${rv.description}`);
              rv.correct_answers.forEach((ans, idx) => {
                console.log(`  - Answer ${idx + 1}: ${ans.content}`);
              });
            }
          });

          const { confirm } = await inquirer.prompt({
            type: "confirm",
            name: "confirm",
            message: "Generate an HTML file to better view answer?",
            default: true,
          });

          if (confirm) {
            const outputfile = path.join(
              path.dirname(fileURLToPath(import.meta.url)),
              "QA.html"
            );
            fs.writeFileSync(
              outputfile,
              `
            <!DOCTYPE html>
            <html lang="zh-Hans">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Quiz Answer</title>
                <style>
                    body{
                        font-family: sans-serif;
                    }
                    .question{
                        font-size: 20px;
                        font-weight: bold;
                    }
                    .choice{
                        font-size: 16px;
                        margin-left: 20px;
                    }
                    .answer{
                        font-size: 20px;
                        margin-left: 20px;
                        font-weight: bold;
                        color: blue;
                    }
                </style>
            </head>
            <body>
                <h1>Quiz Answer</h1>
                ${oral.subjects
                  .map(
                    (rv) => `
                    <div class="question">Q#${rv.id} -: ${rv.description}</div>
                    ${rv.options
                      ?.map(
                        (rx) =>
                          `<div class="choice">Choice ${String.fromCharCode([65 + rx.sort])}: ${rx.content}</div>`
                      )
                      .join("")}
                    ${rv.options
                      ?.filter((rx) => rx.is_answer)
                      .map(
                        (ans) =>
                          `<div class="answer">Answer: ${String.fromCharCode([65 + ans.sort])}. ${ans.content}</div>`
                      )
                      .join("")}
                    ${rv.correct_answers
                      ?.map(
                        (ans, idx) =>
                          `<div class="answer">Answer ${idx + 1}: ${ans.content}</div>`
                      )
                      .join("")}
                `
                  )
                  .join("")}
            </body>
            </html>
            `
            );
            console.log("[+] HTML file generated at: ", outputfile);
          }
        }

        const { another } = await inquirer.prompt({
          type: "confirm",
          name: "another",
          message: "Scan another course?",
          default: true,
        });
        continueScanning = another;
      }
    })
    .catch((e) => {
      console.log("Exit innormaly with error: ", e);
    });
})();



/* One example of fill_in_blank type:

...
  "subjects_data": {
    "subjects": [
      {
        "answer_explanation": "",
        "answer_number": 3,
        "correct_answers": [
          {
            "alternates": [],
            "content": "5",
            "sort": 0,
            "uuid": null
          },
          {
            "alternates": [],
            "content": "4",
            "sort": 1,
            "uuid": null
          },
          {
            "alternates": [],
            "content": "4",
            "sort": 2,
            "uuid": null
          }
        ],
        "data": {

        },
        "description": "\u003Cp\u003E关系person(id, gender, age) 有如下5个记录：\u003C/p\u003E\u003Cp\u003E       p1  M  30\u003C/p\u003E\u003Cp\u003E       p2  F   28\u003C/p\u003E\u003Cp\u003E       p3  M  20\u003C/p\u003E\u003Cp\u003E       p4  F  18\u003C/p\u003E\u003Cp\u003E       p5  M  10\u003C/p\u003E\u003Cp\u003E对上述关系依次下列SQL 语句：\u003C/p\u003E\u003Col\u003E\u003Cli\u003Eset autocommit=0；\u003C/li\u003E\u003Cli\u003E\u003Cspan style=\"font-size: 14px;\"\u003Eupdate person set age=age+1 where id='p1';\u003C/span\u003E\u003Cbr\u003E\u003C/li\u003E\u003Cli\u003Einsert into  person values ('p6', 'M', 25); \u003C/li\u003E\u003Cli\u003Erollback;\u003C/li\u003E\u003Cli\u003E\u003Cspan style=\"font-size: 14px;\"\u003Edelete from person where id='p2';\u003C/span\u003E\u003Cbr\u003E\u003C/li\u003E\u003Cli\u003Ecommit;\u003C/li\u003E\u003Cli\u003Edelete from person where age&lt;20;\u003C/li\u003E\u003Cli\u003E\u003Cspan style=\"font-size: 14px;\"\u003Erollback;\u003C/span\u003E\u003C/li\u003E\u003C/ol\u003E\u003Cp\u003E那么，第 4步的语句执行之后，person表有\u003Cspan class=\"__blank__\" contenteditable=\"false\" data-id=\"1640267585\"\u003E   \u003Cspan class=\"circle-number\"\u003E1\u003C/span\u003E   \u003C/span\u003E个记录；\u003C/p\u003E\u003Cp\u003E           第 6步\u003Cspan style=\"font-size: 14px;\"\u003E的语句执行\u003C/span\u003E\u003Cspan style=\"font-size: 14px;\"\u003E之后，person表有\u003Cspan class=\"__blank__\" contenteditable=\"false\" data-id=\"1640267586\"\u003E   \u003Cspan class=\"circle-number\"\u003E2\u003C/span\u003E   \u003C/span\u003E个记录；\u003C/span\u003E\u003C/p\u003E\u003Cp\u003E           第 8步\u003Cspan style=\"font-size: 14px;\"\u003E的语句执行\u003C/span\u003E之后，\u003Cspan style=\"font-size: 14px;\"\u003Eperson表有\u003Cspan class=\"__blank__\" contenteditable=\"false\" data-id=\"1640267587\"\u003E   \u003Cspan class=\"circle-number\"\u003E3\u003C/span\u003E   \u003C/span\u003E个记录；\u003C/span\u003E\u003C/p\u003E",
        "difficulty_level": "medium",
        "id": *******,
        "last_updated_at": "2026-03-24T07:37:48Z",
        "note": null,
        "options": [],
        "parent_id": null,
        "point": "6.0",
        "settings": {
          "case_sensitive": true,
          "required": false,
          "status": "start",
          "unordered": false
        },
        "sort": 0,
        "sub_subjects": [],
        "type": "fill_in_blank",
        "wrong_explanation": ""
      }
    ]
  },
...
  */