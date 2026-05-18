

import inquirer from "inquirer";

async function pickCourseId(courses) {
  const coursesResp = await courses.fetch(
    `https://courses.zju.edu.cn/api/my-courses`,
    {
        headers:{"Content-Type":"application/json"},
        method:"POST",
        body:JSON.stringify(
            {
  "fields": "id,name,course_code,department(id,name),grade(id,name),klass(id,name),course_type,cover,small_cover,start_date,end_date,is_started,is_closed,academic_year_id,semester_id,credit,compulsory,second_name,display_name,created_user(id,name),org(is_enterprise_or_organization),org_id,public_scope,audit_status,audit_remark,can_withdraw_course,imported_from,allow_clone,is_instructor,is_team_teaching,is_default_course_cover,archived,instructors(id,name,email,avatar_small_url),course_attributes(teaching_class_name,is_during_publish_period,copy_status,tip,data,audience_type,graduate_method),user_stick_course_record(id),classroom_schedule",
  "page": 1,
  "page_size": 1000,
  "conditions": {
    "status": ["ongoing", "notStarted", "closed"],
    "keyword": "",
    "classify_type": "recently_started",
    "display_studio_list": false
  },
  "showScorePassedStatus": false
}

        )
    }
  ).then(v=>v.json());



  const courseList = coursesResp.courses || [];

  const answer = await inquirer.prompt([
    {
      type: "list",
      name: "courseId",
      message: "请选择课程：",
      pageSize: 20,
      loop: true,
      choices: [...courseList.map((course) => ({
        name: `${course.name} (ID: ${course.id})`,
        value: course.id,
      })), {
        name: "（手动输入课程ID）",
        value: "__manual__",
      }],
    },
  ]);

  if (answer.courseId === "__manual__") {
    const manualAnswer = await inquirer.prompt([
      {
        type: "input",
        name: "courseId",
        message: "请输入课程ID：",
        validate: (input) => {
            if (!/^\d+$/.test(input)) {
                return "课程ID应为纯数字。";
            }
            return true;
        }
        },
    ]);
    return manualAnswer.courseId;
  }

  return answer.courseId;
}


export {pickCourseId}