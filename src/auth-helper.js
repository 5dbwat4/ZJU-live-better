/**
 * 认证辅助模块
 * 用于：密码登录 → 获取 Cookie → 销毁密码
 */
import { COURSES, ZJUAM } from "login-zju";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * 使用密码登录并获取 Cookie
 * @param {string} username - 学号
 * @param {string} password - 密码（用完即销毁，不保存）
 * @returns {Promise<{ok: boolean, cookie?: string, error?: string}>}
 */
export async function loginAndGetCookie(username, password) {
  if (!username || !password) {
    return { ok: false, error: "用户名或密码不能为空" };
  }

  try {
    console.log(`[AuthHelper] 开始为用户 ${username} 登录...`);
    
    // 使用 login-zju 库进行登录
    const zjuam = new ZJUAM(username, password);
    const courses = new COURSES(zjuam);
    
    // 触发登录流程：访问一个需要认证的 API
    const resp = await courses.fetch("https://courses.zju.edu.cn/api/users/self");
    
    if (resp.status !== 200) {
      const text = await resp.text();
      console.error(`[AuthHelper] 登录失败: status=${resp.status}, body=${text.slice(0, 200)}`);
      return { ok: false, error: `登录失败 (${resp.status})，请检查用户名和密码` };
    }

    // 获取用户信息确认登录成功
    const userData = await resp.json();
    console.log(`[AuthHelper] 登录成功！用户: ${userData.name || userData.id}`);

    // 从 ZJUAM 实例中提取 Cookie
    // login-zju 库内部维护了 Cookie，我们需要获取它
    const cookie = await extractCookieFromSession(courses, zjuam);
    
    if (!cookie) {
      return { ok: false, error: "登录成功但无法提取 Cookie" };
    }

    console.log(`[AuthHelper] Cookie 获取成功，长度: ${cookie.length}`);
    
    // 验证 Cookie 有效性
    const valid = await verifyCookie(cookie);
    if (!valid) {
      return { ok: false, error: "获取的 Cookie 验证失败" };
    }

    return { ok: true, cookie };
  } catch (e) {
    console.error(`[AuthHelper] 登录异常:`, e);
    return { ok: false, error: e.message || "登录过程发生错误" };
  }
}

/**
 * 从登录会话中提取 Cookie
 */
async function extractCookieFromSession(courses, zjuam) {
  try {
    // 方法1：尝试从 zjuam 实例获取 cookie
    if (zjuam.cookie) {
      return zjuam.cookie;
    }
    if (zjuam._cookie) {
      return zjuam._cookie;
    }
    
    // 方法2：尝试从 courses 实例获取
    if (courses.cookie) {
      return courses.cookie;
    }
    if (courses._cookie) {
      return courses._cookie;
    }
    
    // 方法3：通过请求获取 Set-Cookie
    // 访问一个会返回完整 Cookie 的页面
    const resp = await courses.fetch("https://courses.zju.edu.cn/user/courses", {
      redirect: "manual"
    });
    
    // 尝试从响应头获取 Cookie（如果有 Set-Cookie）
    const setCookie = resp.headers.get("set-cookie");
    if (setCookie) {
      // 解析 Set-Cookie 并构建 Cookie 字符串
      const cookies = [];
      const parts = setCookie.split(",").map(s => s.trim());
      for (const part of parts) {
        const match = part.match(/^([^=]+)=([^;]*)/);
        if (match) {
          cookies.push(`${match[1]}=${match[2]}`);
        }
      }
      if (cookies.length > 0) {
        return cookies.join("; ");
      }
    }

    // 方法4：尝试访问 zjuam 的内部属性
    const possibleProps = ['cookies', 'cookieJar', 'jar', 'session'];
    for (const prop of possibleProps) {
      if (zjuam[prop]) {
        const val = zjuam[prop];
        if (typeof val === 'string') return val;
        if (typeof val === 'object' && val.toString) {
          const str = val.toString();
          if (str && str !== '[object Object]') return str;
        }
      }
    }

    // 方法5：遍历 zjuam 对象查找 Cookie
    for (const key of Object.keys(zjuam)) {
      const val = zjuam[key];
      if (typeof val === 'string' && val.includes('iPlanetDirectoryPro')) {
        return val;
      }
    }

    console.warn("[AuthHelper] 无法从会话中提取 Cookie，尝试重新构建...");
    
    // 方法6：重新发起请求并手动收集 Cookie
    return await collectCookieViaRequests(courses);
  } catch (e) {
    console.error("[AuthHelper] 提取 Cookie 失败:", e);
    return null;
  }
}

/**
 * 通过发起请求收集 Cookie
 */
async function collectCookieViaRequests(courses) {
  const collectedCookies = new Map();
  
  // 访问几个关键页面收集 Cookie
  const urls = [
    "https://courses.zju.edu.cn/",
    "https://courses.zju.edu.cn/user",
    "https://courses.zju.edu.cn/api/users/self"
  ];
  
  for (const url of urls) {
    try {
      const resp = await courses.fetch(url, { redirect: "manual" });
      const setCookies = resp.headers.getSetCookie?.() || [];
      const single = resp.headers.get("set-cookie");
      const all = setCookies.length ? setCookies : (single ? [single] : []);
      
      for (const cookieStr of all) {
        const match = cookieStr.match(/^([^=]+)=([^;]*)/);
        if (match) {
          collectedCookies.set(match[1], match[2]);
        }
      }
    } catch (e) {
      // 忽略单个请求错误
    }
  }
  
  if (collectedCookies.size === 0) {
    return null;
  }
  
  return Array.from(collectedCookies.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/**
 * 验证 Cookie 是否有效
 */
async function verifyCookie(cookie) {
  try {
    const resp = await fetch("https://courses.zju.edu.cn/api/users/self", {
      headers: {
        "Cookie": cookie,
        "User-Agent": DEFAULT_UA,
      },
      redirect: "manual",
    });
    
    if (resp.status === 200) {
      return true;
    }
    
    // 302 重定向到登录页说明 Cookie 无效
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location") || "";
      if (location.includes("identity.zju.edu.cn") || location.includes("login")) {
        return false;
      }
    }
    
    return resp.status === 200;
  } catch (e) {
    console.error("[AuthHelper] Cookie 验证失败:", e);
    return false;
  }
}

/**
 * 使用已有 Cookie 测试是否仍然有效
 */
export async function testCookieValid(cookie) {
  return verifyCookie(cookie);
}

