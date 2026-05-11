#!/usr/bin/env node

import inquirer from 'inquirer';
import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const scripts = [
  { name: '学在浙大: 生成作业待办 (todolist)', value: 'courses.zju/todolist.js' },
  { name: '学在浙大: 可靠待办列表 (reliableTodolist)', value: 'courses.zju/reliableTodolist.js' },
  { name: '学在浙大: 下载课件 (materialDown)', value: 'courses.zju/materialDown.js' },
  { name: 'courses.zju/autosign.js', value: 'courses.zju/autosign.js' },
  { name: 'courses.zju/quizanswer.js', value: 'courses.zju/quizanswer.js' },
  { name: 'courses.zju/watchVideo.js', value: 'courses.zju/watchVideo.js' },
  { name: '智云课堂: 生成课程 Markdown (generateCourseMd)', value: 'classroom.zju/generateCourseMd.js' },
  { name: '智云课堂: 获取视频链接 (getVideoURL)', value: 'classroom.zju/getVideoURL.js' },
  { name: 'Webplus: 保存通知及附件 (saveDoc)', value: 'webplus.zju/saveDoc.js' },
];

async function main() {
  const { selectedScript } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedScript',
      message: 'Please select the script to run:',
      choices: scripts,
      pageSize: 10,
    },
  ]);

  const scriptPath = path.join(projectRoot, selectedScript);

  console.log(`\x1b[32mStarting ${selectedScript}...\x1b[0m`);

  const child = fork(scriptPath, [], {
    cwd: projectRoot, 
    stdio: 'inherit',
  });

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.log(`\n\x1b[31mScript exited with error, exit code: ${code}\x1b[0m`);
    }
  });
}

main().catch((err) => {
  console.error('An error occurred:', err);
  process.exit(1);
});