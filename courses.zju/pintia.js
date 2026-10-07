/** PTA 独立检查；--login 打开浏览器供人工完成登录验证。 */
import "dotenv/config";
import { getPintiaConfigStatus, getPintiaProblemSets } from "../shared/pintia.js";

try {
  if (!getPintiaConfigStatus().configured) {
    throw new Error("请在 .env 配置 PINTIA_USERNAME 和 PINTIA_PASSWORD。");
  }
  const manual = process.argv.includes("--login");
  if (manual) console.log("正在打开 PTA 登录页，如出现验证码，请在浏览器中完成验证。");
  const sets = await getPintiaProblemSets(manual ? { forceLogin: true, headless: false } : undefined);
  const active = sets.filter((set) => set.endAt && new Date(set.endAt) > new Date());
  console.log(`PTA 抓取成功：${active.length} 个未截止题目集。`);
  for (const set of active) {
    console.log(`${set.name}\n  截止：${new Date(set.endAt).toLocaleString("zh-CN")}\n  https://pintia.cn/problem-sets/${set.id}/exam/problems`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
