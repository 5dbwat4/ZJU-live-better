import express from "express";
import path from "path";
import http from "http";
import https from "https";
import crypto from "crypto";
import { fileURLToPath } from "url";

function adminAuth(token) {
  return (req, res, next) => {
    // 强制要求配置有效 token，长度不少于 16，避免“空 token 即放行”
    if (!token || typeof token !== "string" || token.length < 16) {
      console.error("[SECURITY] CONTROL_TOKEN 未配置或长度不足（>=16）");
      return res.status(500).json({ ok: false, message: "server config invalid" });
    }

    const provided =
      req.query.token ||
      req.headers["x-token"] ||
      req.headers["x-access-token"] ||
      "";
    const providedBuf = Buffer.from(String(provided));
    const tokenBuf = Buffer.from(token);

    // 长度不一致直接拒绝，避免 timingSafeEqual 抛错
    if (providedBuf.length === tokenBuf.length) {
      try {
        if (crypto.timingSafeEqual(providedBuf, tokenBuf)) {
          return next();
        }
      } catch {
        // fallthrough to unauthorized
      }
    }
    return res.status(401).json({ ok: false, message: "unauthorized" });
  };
}

function userAuth(manager) {
  return (req, res, next) => {
    const userToken =
      req.query.userToken ||
      req.headers["x-user-token"] ||
      req.headers["x-user"];
    if (!userToken) return res.status(401).json({ ok: false, message: "missing userToken" });
    const cfg = manager.validateUserToken(userToken);
    if (!cfg) return res.status(401).json({ ok: false, message: "invalid userToken" });
    req.userConfig = cfg;
    req.userToken = userToken;
    next();
  };
}

export function createControlServer({ manager, token, port = 3000, httpsOptions = null }) {
  const app = express();
  app.use(express.json());

  // 基础安全响应头
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    next();
  });

  // Admin APIs (must be before static to avoid conflicts)
  app.use("/admin", adminAuth(token));

  // Static pages
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const publicDir = path.join(__dirname, "..", "public");
  app.use(
    express.static(publicDir, {
      dotfiles: "deny",
      index: ["index.html"],
    })
  );

  app.get("/admin/status", (req, res) => {
    res.json({ ok: true, users: manager.listUsers() });
  });

  app.get("/admin/users", (req, res) => {
    res.json({ ok: true, users: manager.listUsers() });
  });

  app.post("/admin/users", async (req, res) => {
    const body = req.body || {};
    try {
      const user = await manager.upsertUser(body);
      res.json({ ok: true, user });
    } catch (e) {
      res.status(400).json({ ok: false, message: e.message });
    }
  });

  app.delete("/admin/users/:id", async (req, res) => {
    const id = req.params.id;
    const result = await manager.deleteUser(id);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  app.get("/admin/users/:id/status", (req, res) => {
    const id = req.params.id;
    const result = manager.status(id);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  app.get("/admin/users/:id/logs", async (req, res) => {
    const id = req.params.id;
    const result = await manager.logs(id);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  app.delete("/admin/users/:id/logs", async (req, res) => {
    const id = req.params.id;
    const result = await manager.clearLogs(id);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  app.post("/admin/users/:id/start", async (req, res) => {
    const { forceOverride } = req.body || {};
    const result = await manager.startUser(req.params.id, { forceOverride });
    if (!result.ok && !result.needConfirm) return res.status(404).json(result);
    res.json(result);
  });

  app.post("/admin/users/:id/stop", async (req, res) => {
    const { forceOverride } = req.body || {};
    const result = await manager.stopUser(req.params.id, { forceOverride });
    if (!result.ok && !result.needConfirm) return res.status(404).json(result);
    res.json(result);
  });

  app.post("/admin/users/:id/window", async (req, res) => {
    const { startTime, endTime, enableSchedule } = req.body || {};
    const result = await manager.updateWindow(req.params.id, {
      startTime,
      endTime,
      enableSchedule,
    });
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  // Invites (admin)
  app.get("/admin/invites", async (req, res) => {
    const list = await manager.store.listInvites();
    res.json({ ok: true, invites: list });
  });

  app.post("/admin/invites", async (req, res) => {
    const { code, note } = req.body || {};
    try {
      const created = await manager.store.createInvite({ code, note });
      res.json({ ok: true, invite: created });
    } catch (e) {
      res.status(400).json({ ok: false, message: e.message });
    }
  });

  app.delete("/admin/invites/:code", async (req, res) => {
    const code = req.params.code;
    try {
      const deleted = await manager.store.deleteInvite(code);
      if (!deleted) return res.status(404).json({ ok: false, message: "not found" });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, message: e.message });
    }
  });

  // User-facing APIs (invite + token)
  app.post("/user/signup", async (req, res) => {
    const { inviteCode, username, password, authMode, cookie } = req.body || {};
    try {
      const result = await manager.createViaInvite({ inviteCode, username, password, authMode, cookie });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(400).json({ ok: false, message: e.message });
    }
  });

  app.use("/user", userAuth(manager));

  app.get("/user/me/status", async (req, res) => {
    const result = await manager.statusByToken(req.userToken);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  app.get("/user/me/logs", async (req, res) => {
    const result = await manager.logsByToken(req.userToken);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  app.delete("/user/me/logs", async (req, res) => {
    const result = await manager.clearLogsByToken(req.userToken);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  app.post("/user/me/update", async (req, res) => {
    try {
      const user = await manager.updateByToken(req.userToken, req.body || {});
      res.json({ ok: true, user });
    } catch (e) {
      res.status(400).json({ ok: false, message: e.message });
    }
  });

  app.post("/user/me/start", async (req, res) => {
    const { forceOverride } = req.body || {};
    const result = await manager.startByToken(req.userToken, { forceOverride });
    if (!result.ok && !result.needConfirm) return res.status(404).json(result);
    res.json(result);
  });

  app.post("/user/me/stop", async (req, res) => {
    const { forceOverride } = req.body || {};
    const result = await manager.stopByToken(req.userToken, { forceOverride });
    if (!result.ok && !result.needConfirm) return res.status(404).json(result);
    res.json(result);
  });

  app.post("/user/me/window", async (req, res) => {
    const { startTime, endTime, enableSchedule } = req.body || {};
    const result = await manager.updateWindowByToken(req.userToken, {
      startTime,
      endTime,
      enableSchedule,
    });
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  let server;
  if (httpsOptions) {
    server = https.createServer(httpsOptions, app).listen(port, () => {
      console.log(`[Control] HTTPS server listening on ${port}`);
    });
  } else {
    server = http.createServer(app).listen(port, () => {
      console.log(`[Control] HTTP server listening on ${port}`);
    });
  }

  return { app, server };
}


