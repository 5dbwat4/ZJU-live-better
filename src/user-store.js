import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { encrypt, decrypt } from "./crypto.js";

const defaultDataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
const defaultStorePath = path.join(defaultDataDir, "users.json");
const defaultInvitePath = path.join(defaultDataDir, "invites.json");

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function loadFile(filePath, fallback = []) {
  try {
    const buf = await fs.readFile(filePath, "utf8");
    return JSON.parse(buf);
  } catch (e) {
    return fallback;
  }
}

function randomToken(size = 24) {
  return crypto.randomBytes(size).toString("hex");
}

export class UserStore {
  constructor({ secret, dataPath = defaultStorePath, invitePath = defaultInvitePath } = {}) {
    this.secret = secret;
    this.dataPath = dataPath;
    this.invitePath = invitePath;
    this.dataDir = path.dirname(dataPath);
  }

  async loadUsers() {
    await ensureDir(this.dataDir);
    const users = await loadFile(this.dataPath, []);
    return Array.isArray(users) ? users : [];
  }

  async saveUsers(users) {
    await ensureDir(this.dataDir);
    await fs.writeFile(this.dataPath, JSON.stringify(users, null, 2), "utf8");
  }

  async loadInvites() {
    await ensureDir(this.dataDir);
    const invites = await loadFile(this.invitePath, []);
    return Array.isArray(invites) ? invites : [];
  }

  async saveInvites(invites) {
    await ensureDir(this.dataDir);
    await fs.writeFile(this.invitePath, JSON.stringify(invites, null, 2), "utf8");
  }

  encryptPassword(plain) {
    return encrypt(this.secret, plain);
  }

  decryptPassword(ciphertext) {
    return decrypt(this.secret, ciphertext);
  }

  encryptCookie(plain) {
    return encrypt(this.secret, plain);
  }

  decryptCookie(ciphertext) {
    return decrypt(this.secret, ciphertext);
  }

  hashCode(code) {
    return crypto.createHash("sha256").update(this.secret + code).digest("hex");
  }

  async createInvite({ code, note } = {}) {
    const invites = await this.loadInvites();
    const finalCode = code || randomToken(8).slice(0, 10);
    const hash = this.hashCode(finalCode);
    invites.push({
      hash,
      code: finalCode, // 恢复存储明文邀请码，便于管理员查看
      note: note || "",
      used: false,
      usedBy: null,
      createdAt: new Date().toISOString(),
    });
    await this.saveInvites(invites);
    return { code: finalCode };
  }

  async listInvites() {
    const invites = await this.loadInvites();
    // 移除 hash，保留 code 供管理员查看
    return invites.map((i) => {
      const { hash, ...rest } = i;
      return rest;
    });
  }

  async useInvite(code, userId) {
    const invites = await this.loadInvites();
    const hash = this.hashCode(code);
    const invite = invites.find((i) => i.hash === hash && !i.used);
    if (!invite) return false;
    invite.used = true;
    invite.usedBy = userId;
    invite.usedAt = new Date().toISOString();
    await this.saveInvites(invites);
    return true;
  }

  async deleteInvite(code) {
    const invites = await this.loadInvites();
    const hash = this.hashCode(code);
    const idx = invites.findIndex((i) => i.hash === hash || i.code === code);
    if (idx === -1) return false;
    invites.splice(idx, 1);
    await this.saveInvites(invites);
    return true;
  }

  newUserToken() {
    return randomToken(16);
  }
}

