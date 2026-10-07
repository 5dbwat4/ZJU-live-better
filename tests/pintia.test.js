import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { createPintiaClient, getPintiaConfigStatus, loginWithBrowser } from "../shared/pintia.js";

const credentials = { PINTIA_USERNAME: "student@example.test", PINTIA_PASSWORD: "fixture-password" };
const state = (value) => ({
  cookies: [{ name: "PTASession", value, domain: ".pintia.cn", path: "/", expires: -1, secure: true, httpOnly: true, sameSite: "Lax" }],
  origins: [],
});
const sets = [{ id: "set-id", name: "课程练习", endAt: "2099-01-01T00:00:00Z" }];

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pintia-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, "storage-state.json");
  const env = { ...credentials, ...options.env };
  const calls = { login: 0, states: [], responsesDisposed: 0, contextsDisposed: 0 };
  const login = async (args) => {
    calls.login++;
    assert.equal(args.username, env.PINTIA_USERNAME);
    assert.equal(args.password, env.PINTIA_PASSWORD);
    return state("new-session");
  };
  const createContext = async (savedState) => {
    calls.states.push(savedState);
    return {
      async get(url, { params, maxRedirects }) {
        assert.equal(url, "/api/problem-sets");
        assert.equal(maxRedirects, 0);
        assert.ok(Number.isFinite(Date.parse(JSON.parse(params.filter).endAtAfter)));
        const result = options.response ? await options.response(calls.states.length) : {};
        return {
          status: () => result.status ?? 200,
          headers: () => result.headers ?? { "content-type": "application/json" },
          json: async () => result.data ?? { problemSets: sets },
          dispose: async () => { calls.responsesDisposed++; },
        };
      },
      storageState: async () => options.rotatedState || savedState,
      dispose: async () => { calls.contextsDisposed++; },
    };
  };
  const clientOptions = { env, statePath, createContext, login };
  return { client: createPintiaClient(clientOptions), clientOptions, calls, statePath, env };
}

test("first fetch logs in with configured credentials and persists verified state", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.client.getProblemSets(), sets);
  assert.equal(f.calls.login, 1);
  const saved = await readFile(f.statePath, "utf8");
  assert.equal(JSON.parse(saved).storageState.cookies[0].value, "new-session");
  assert.ok(!saved.includes(credentials.PINTIA_PASSWORD));
  assert.ok(!saved.includes(credentials.PINTIA_USERNAME));
  assert.equal(f.calls.responsesDisposed, 1);
  assert.equal(f.calls.contextsDisposed, 1);
});

test("another process can reuse saved state and retain server cookie rotation", async (t) => {
  const f = await fixture(t, { rotatedState: state("rotated-session") });
  await f.client.getProblemSets();
  const restarted = createPintiaClient({ ...f.clientOptions, login: async () => assert.fail("must reuse state") });
  assert.deepEqual(await restarted.getProblemSets(), sets);
  assert.equal(f.calls.states.at(-1).cookies[0].value, "rotated-session");
});

test("expired session triggers one login and retries the protected request", async (t) => {
  let expired = false;
  const f = await fixture(t, { response: () => expired ? (expired = false, { status: 401 }) : {} });
  await f.client.getProblemSets();
  expired = true;
  assert.deepEqual(await f.client.getProblemSets(), sets);
  assert.equal(f.calls.login, 2);
  assert.equal(f.calls.contextsDisposed, 3);
});

test("concurrent refreshes share one login and one request", async (t) => {
  const f = await fixture(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => f.client.getProblemSets()));
  assert.ok(results.every((result) => result === results[0]));
  assert.equal(f.calls.login, 1);
  assert.equal(f.calls.states.length, 1);
});

for (const status of [403, 429, 500]) {
  test(`HTTP ${status} is reported without resubmitting credentials`, async (t) => {
    let fail = false;
    const f = await fixture(t, { response: () => fail ? { status } : {} });
    await f.client.getProblemSets();
    fail = true;
    await assert.rejects(f.client.getProblemSets(), (error) => error.code === "HTTP");
    assert.equal(f.calls.login, 1);
    assert.equal(f.calls.responsesDisposed, 2);
  });
}

test("malformed HTTP 200 response does not become an empty todo list", async (t) => {
  const f = await fixture(t, { response: () => ({ data: { unexpected: [] } }) });
  await assert.rejects(f.client.getProblemSets(), (error) => error.code === "RESPONSE");
  await assert.rejects(readFile(f.statePath), { code: "ENOENT" });
});

test("failed reauthentication stops after one retry and keeps the last verified state", async (t) => {
  let expired = false;
  const f = await fixture(t, { response: () => expired ? { status: 401 } : {} });
  await f.client.getProblemSets();
  const previous = await readFile(f.statePath, "utf8");
  expired = true;
  await assert.rejects(f.client.getProblemSets(), (error) => error.code === "SESSION_EXPIRED");
  assert.equal(f.calls.login, 2);
  assert.equal(await readFile(f.statePath, "utf8"), previous);
});

test("changing configured account does not reuse the old session or manual Cookie", async (t) => {
  const f = await fixture(t);
  await f.client.getProblemSets();
  f.env.PINTIA_USERNAME = "other@example.test";
  f.env.PINTIA_COOKIE = "PTASession=old-account-cookie";
  await f.client.getProblemSets();
  assert.equal(f.calls.login, 2);
  assert.ok(f.calls.states.every((saved) => saved.cookies[0].value !== "old-account-cookie"));
});

test("optional PTA integration makes no requests when unconfigured", async (t) => {
  const f = await fixture(t, { env: { PINTIA_USERNAME: "", PINTIA_PASSWORD: "" } });
  assert.deepEqual(await f.client.getProblemSets(), []);
  assert.equal(f.calls.login, 0);
  assert.equal(f.calls.states.length, 0);
});

test("partial credentials report a configuration error", async (t) => {
  const f = await fixture(t, { env: { PINTIA_PASSWORD: "" } });
  await assert.rejects(f.client.getProblemSets(), (error) => error.code === "CONFIG");
  assert.equal(f.calls.login, 0);
});

test("legacy Cookie mode still works, including values containing equals signs", async (t) => {
  const f = await fixture(t, { env: { PINTIA_USERNAME: "", PINTIA_PASSWORD: "", PINTIA_COOKIE: "PTASession=token==; other=value" } });
  assert.deepEqual(await f.client.getProblemSets(), sets);
  assert.equal(f.calls.login, 0);
  assert.equal(f.calls.states[0].cookies[0].value, "token==");
});

test("corrupt cached JSON is replaced after a verified login", async (t) => {
  const f = await fixture(t);
  await writeFile(f.statePath, "{broken");
  assert.deepEqual(await f.client.getProblemSets(), sets);
  assert.equal(f.calls.login, 1);
});

test("a login redirect is treated as expiry rather than a JSON error", async (t) => {
  let redirect = false;
  const f = await fixture(t, { response: () => redirect ? (redirect = false, { status: 302, headers: { location: "/auth/login" } }) : {} });
  await f.client.getProblemSets();
  redirect = true;
  assert.deepEqual(await f.client.getProblemSets(), sets);
  assert.equal(f.calls.login, 2);
});

test("browser errors never expose filled credentials and always close the browser", async () => {
  let closed = false;
  const browserType = { launch: async () => ({
    newContext: async () => ({ newPage: async () => ({
      setDefaultTimeout() {}, goto: async () => {},
      locator() { throw new Error(`fill failed: ${credentials.PINTIA_PASSWORD}`); },
    }) }),
    close: async () => { closed = true; },
  }) };
  await assert.rejects(
    loginWithBrowser({ username: credentials.PINTIA_USERNAME, password: credentials.PINTIA_PASSWORD }, browserType),
    (error) => error.code === "LOGIN_FAILED" && !error.message.includes(credentials.PINTIA_PASSWORD),
  );
  assert.ok(closed);
});

test("normal browser form flow saves HttpOnly cookies using an explicitly direct browser", async () => {
  let submitted;
  const browserType = { launch: async (options) => {
    assert.deepEqual(options.args, ["--no-proxy-server"]);
    const browser = await chromium.launch(options);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (contextOptions) => {
      const context = await newContext(contextOptions);
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/auth/login") {
          await route.fulfill({ contentType: "text/html; charset=utf-8", body: `
            <button onclick="this.hidden=true;document.querySelector('form').hidden=false">密码登录</button>
            <form hidden>
              <input type="text" placeholder="邮箱或手机号" name="email">
              <input type="password" name="password">
              <label><input type="checkbox" name="remember">记住我</label>
              <button>登录</button>
            </form>
            <script>document.querySelector('form').onsubmit=async(event)=>{
              event.preventDefault();
              await fetch('/api/fixture-login',{method:'POST',body:new URLSearchParams(new FormData(event.target))});
              location.href='/problem-sets/dashboard';
            };</script>` });
        } else if (url.pathname === "/api/fixture-login") {
          submitted = new URLSearchParams(route.request().postData());
          await route.fulfill({ status: 200, headers: { "Set-Cookie": "PTASession=fixture; Path=/; Secure; HttpOnly; SameSite=Lax" }, body: "{}" });
        } else {
          await route.fulfill({ contentType: "text/html; charset=utf-8", body: "题目集" });
        }
      });
      return context;
    };
    return browser;
  } };
  const saved = await loginWithBrowser({ username: credentials.PINTIA_USERNAME, password: credentials.PINTIA_PASSWORD }, browserType);
  assert.equal(submitted.get("email"), credentials.PINTIA_USERNAME);
  assert.equal(submitted.get("password"), credentials.PINTIA_PASSWORD);
  assert.equal(submitted.get("remember"), "on");
  assert.ok(saved.cookies.some((cookie) => cookie.name === "PTASession" && cookie.httpOnly));
});

test("configuration status reflects automatic login without a manual Cookie", () => {
  assert.deepEqual(getPintiaConfigStatus(credentials), { configured: true, mode: "自动登录" });
  assert.equal(getPintiaConfigStatus({}).configured, false);
});
