#!/usr/bin/env node

/**
 * Webplus 系统存档备份工具（x）
 * 好吧其实是一个保存通知以及*其所有附件*的工具，因为默认情况下直接点击按钮下载的附件会被命名为“[uuid].[ext]”
 * 
 * 理论上使用webplus系统的都可以，像 office.ckc.zju.edu.cn 或者 cspo.zju.edu.cn 之类的
 * 使用方法是：
 * 1. 命令行'-u URL -o /path/to/save/the/files'
 * 2. 不提供'-u'，会提示你手动输入，不提供'-o'，会使用下面的默认值
 */

import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import readline from 'readline';
import stream from 'stream';
import os from 'os';

const defaultOutputDir = path.join(os.homedir(), 'Documents', 'WebPlusArchive');

// 将回调函数转换为Promise版本
const pipeline = promisify(stream.pipeline);

// 创建readline接口用于用户输入
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    url: null,
    outputDir: defaultOutputDir
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-u' && i + 1 < args.length) {
      result.url = args[i + 1];
      i++;
    } else if (args[i] === '-o' && i + 1 < args.length) {
      result.outputDir = args[i + 1];
      i++;
    }
  }

  return result;
}

// 获取用户输入
function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

// 确保目录存在
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}


// 使用fetch下载文件
async function downloadFile(url, filePath) {
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP错误: ${response.status} ${response.statusText}`);
    }
    
    const fileStream = fs.createWriteStream(filePath);
    const reader = response.body.getReader();
    
    return new Promise((resolve, reject) => {
      function pump() {
        reader.read().then(({ done, value }) => {
          if (done) {
            fileStream.end();
            console.log(`下载成功: ${filePath}`);
            resolve(true);
            return;
          }
          
          fileStream.write(value);
          pump();
        }).catch(reject);
      }
      
      pump();
    });
  } catch (error) {
    console.error(`下载失败 ${url}: ${error.message}`);
    return false;
  }
}

// 清理文件名中的非法字符
function sanitizeFileName(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_');
}

// 获取网页内容
async function fetchHtml(url) {
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP错误: ${response.status} ${response.statusText}`);
    }
    
    return await response.text();
  } catch (error) {
    throw new Error(`获取网页内容失败: ${error.message}`);
  }
}

// 主函数
async function main() {
  try {
    // 解析命令行参数
    const args = parseArgs();
    
    // 获取URL
    let url = args.url;
    if (!url) {
      url = await askQuestion('请输入URL: ');
    }
    
    // 处理输出目录（将~替换为用户主目录）
    let outputDir = args.outputDir;
    if (outputDir.startsWith('~/')) {
      outputDir = path.join(os.homedir(), outputDir.slice(2));
    }
    
    // 确保输出目录存在
    ensureDirectoryExists(outputDir);
    console.log(`输出目录: ${outputDir}`);
    
    // 获取网页内容
    console.log(`正在获取网页内容: ${url}`);
    const html = await fetchHtml(url);
    
    // 使用Cheerio解析HTML
    const $ = cheerio.load(html);
    
    // 提取标题
    const titleElement = $('h1.arti_title');
    let title = '无标题';
    if (titleElement.length) {
      title = titleElement.text().trim();
    }
    
    // 清理标题用于文件名
    const cleanTitle = sanitizeFileName(title);
    
    // 提取正文内容
    const articleContent = $('div .article').html() || $('body').html();
    
    // 创建完整的HTML文档
    const fullHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
</head>
<body>
  ${articleContent}
</body>
</html>`;
    
    // 保存HTML文件
    const htmlFilePath = path.join(outputDir, `${cleanTitle}.html`);
    fs.writeFileSync(htmlFilePath, fullHtml, 'utf8');
    console.log(`已保存HTML文件: ${htmlFilePath}`);
    
    // 查找并下载所有附件
    console.log('正在查找附件...');
    
    // 查找所有可能的附件链接
    const attachmentLinks = [];
    
    // 查找带有sudyfile-attr属性的链接
    $('a[sudyfile-attr]').each((i, elem) => {
      const link = $(elem);
      const href = link.attr('href');
      const sudyfileAttr = link.attr('sudyfile-attr');
      
      let fileName = link.text().trim();
      
      try {
        // 尝试解析sudyfile-attr属性
        const attr = JSON.parse(sudyfileAttr.replace(/'/g, '"'));
        if (attr.title) {
          fileName = attr.title;
        }else{
            fileName = link.text().trim();
        }
      } catch (e) {
        // 如果解析失败，使用链接文本作为文件名
        console.warn(`无法解析sudyfile-attr属性: ${sudyfileAttr}. 使用链接文本作为文件名。`);
        fileName = link.text().trim();
      }
      
      if (href && !href.startsWith('javascript:')) {
        attachmentLinks.push({
          url: new URL(href, url).href, // 处理相对URL
          fileName: sanitizeFileName(fileName)
        });
      }
    });
    
    // // 查找常见的附件类型
    // $('a[href]').each((i, elem) => {
    //   const link = $(elem);
    //   const href = link.attr('href');
    //   const text = link.text().trim();
      
    //   // 检查是否是常见的附件类型
    //   if (href && /\.(pdf|docx?|xlsx?|zip|rar|7z)$/i.test(href)) {
    //     // 避免重复添加
    //     const alreadyAdded = attachmentLinks.some(item => 
    //       item.url === new URL(href, url).href
    //     );
        
    //     if (!alreadyAdded) {
    //       attachmentLinks.push({
    //         url: new URL(href, url).href,
    //         fileName: sanitizeFileName(text || path.basename(href))
    //       });
    //     }
    //   }
    // });
    
    console.log(`找到 ${attachmentLinks.length} 个附件`);
    
    // 下载所有附件
    for (const attachment of attachmentLinks) {
      const filePath = path.join(outputDir, attachment.fileName);
      console.log(`正在下载: ${attachment.fileName}`);
      await downloadFile(attachment.url, filePath);
    }
    
    console.log('所有操作完成！');
  } catch (error) {
    console.error(`发生错误: ${error.message}`);
  } finally {
    rl.close();
  }
}

// 启动程序
main();