/* 获取学在浙大quiz的答案 */

// 注意这里的quiz是【可以通过“互动”进入的那种】，不是能通过PC端进入的exam

import inquirer from "inquirer";
import { COURSES, ZJUAM } from "login-zju";
import * as fs from "fs";
import * as path from "path";

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
    .then(({ courses }) => {
      return inquirer.prompt({
        type: "list",
        name: "course",
        message: "Choose the course to find the quiz:",
        loop:true,
        choices: courses.map((course) => ({
          name: course.name,
          value: course,
        })),
      });
    })
    .then(async ({ course }) => {
      // console.log(course);

      return courses
        .fetch(
          `https://courses.zju.edu.cn/api/courses/${course.id}/classroom-list`
        )
        .then((v) => v.json());
    })
    .then(({ classrooms }) => {
      const choices = classrooms
      .filter((v) => v.status == "start")
      .map((interaction) => ({
        name: interaction.title,
        value: interaction,
      }))
      if(choices.length==0){
        console.log("No active quiz found.");
        throw "No active quiz found.";
        return;
      }
      return inquirer.prompt({
        type: "list",
        name: "classroom",
        message: "Choose the quiz to answer:",
        choices ,
      });
    }).then(async({classroom})=>{
        return courses.fetch(`https://courses.zju.edu.cn/api/classroom/${classroom.id}/subject`).then(v=>v.json())
    }).then(oral=>{
        oral.subjects.forEach(rv=>{
            console.log(`Q#${rv.id} -: ${rv.description}`);
            rv.options.filter(rx=>rx.is_answer).forEach(ans=>{
                console.log(`  - Answer: ${String.fromCharCode([65+(ans.sort)])}. ${ans.content}`);
            })
        })
        return inquirer
        .prompt({
          type: "confirm",
          name: "confirm",
          message: "Generate an HTML file to better view answer?",
          default: true,
        })
        .then((confirm) => {
          if (confirm.confirm) {
            // const { spawn } = require("child_process");
            fs.writeFileSync(path.join(__dirname,"QA.html"),`
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
                ${oral.subjects.map(rv=>`
                    <div class="question">Q#${rv.id} -: ${rv.description}</div>
                    ${rv.options.map(rx=>`
                        <div class="choice">Choice ${String.fromCharCode([65+(rx.sort)])}: ${rx.content}</div>
                    `).join("")}
                    ${rv.options.filter(rx=>rx.is_answer).map(ans=>`
                        <div class="answer">Answer: ${String.fromCharCode([65+(ans.sort)])}. ${ans.content}</div>
                    `).join("")}
                `).join("")}
            </body>
            </html>
            `)
            console.log("[+] HTML file generated at: ",path.join(__dirname,"QA.html"));
                    }
        });
    })
    .catch(e=>{
      console.log("Exit innormaly with error: ",e);
    });
})();
