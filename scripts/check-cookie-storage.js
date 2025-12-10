// 用户数据检查脚本
import { config } from "dotenv";
import { UserStore } from "../src/user-store.js";

config();

const APP_SECRET = process.env.APP_SECRET;
if (!APP_SECRET) {
  console.error("缺少 APP_SECRET，无法解密数据。");
  process.exit(1);
}

const store = new UserStore({
  secret: APP_SECRET,
  dataPath: process.env.DATA_DIR ? `${process.env.DATA_DIR}/users.json` : undefined,
});

// 测试 Cookie 是否有效
async function testCookieValidity(cookie) {
  try {
    const resp = await fetch("https://courses.zju.edu.cn/api/radar/rollcalls", {
      headers: {
        cookie,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      redirect: "manual",
    });

    console.log(`  HTTP 状态码：${resp.status}`);
    const location = resp.headers.get("location") || "";
    
    if (resp.status === 401 || resp.status === 403) {
      console.log("  ❌ Cookie 无效：服务器返回 401/403");
      return false;
    }
    if (resp.status >= 300 && resp.status < 400 && location.includes("login")) {
      console.log(`  ❌ Cookie 无效：被重定向到登录页`);
      return false;
    }
    if (resp.status === 200) {
      const data = await resp.json();
      console.log(`  ✅ Cookie 有效！返回 ${data.rollcalls?.length || 0} 个签到任务`);
      return true;
    }
    console.log(`  ⚠️ 未知状态：${resp.status}`);
    return false;
  } catch (e) {
    console.log(`  ❌ 请求失败：${e.message}`);
    return false;
  }
}

(async () => {
  const testOnly = process.argv.includes("--test");
  const users = await store.loadUsers();
  if (!users.length) {
    console.log("没有用户数据。");
    return;
  }

  for (const user of users) {
    console.log("\n════════════════════════════════════");
    console.log(`用户名：${user.username}`);
    console.log(`ID：${user.id}`);
    
    const authModeText = user.authMode === "secure_cookie" ? "极致安全" : "省心模式";
    console.log(`认证模式：${authModeText} (${user.authMode})`);
    console.log(`启用状态：${user.enabled ? "✅ 启用" : "⏸️ 禁用"}`);
    console.log(`授权状态：${user.authExpired ? "❌ 已失效" : "✅ 正常"}`);
    
    if (user.authMode === "secure_cookie") {
      console.log(`Cookie：${user.cookieEnc ? "✅ 已存储" : "❌ 缺失"}`);
      console.log(`密码：${user.passwordEnc ? "⚠️ 异常（极致安全模式不应存储密码）" : "✅ 未存储"}`);
      
      if (user.cookieEnc && testOnly) {
        try {
          const cookie = store.decryptCookie(user.cookieEnc);
          console.log(`\n🔍 Cookie 有效性测试：`);
          await testCookieValidity(cookie);
        } catch (e) {
          console.log("❌ 解密 Cookie 失败：", e.message);
        }
      }
    } else {
      console.log(`密码：${user.passwordEnc ? "✅ 已存储（加密）" : "❌ 缺失"}`);
    }
  }
  
  console.log("\n════════════════════════════════════");
  console.log("💡 提示：运行 `node scripts/check-cookie-storage.js --test` 测试极致安全模式用户的 Cookie 有效性");
})();