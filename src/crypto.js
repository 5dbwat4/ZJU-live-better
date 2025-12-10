import crypto from "crypto";

// 使用 APP_SECRET 推导 32 字节密钥
export function deriveKey(secret) {
  if (!secret) {
    throw new Error("APP_SECRET 未设置，无法加密存储用户密码");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

export function encrypt(secret, plaintext) {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(secret, ciphertext) {
  const key = deriveKey(secret);
  const raw = Buffer.from(ciphertext, "base64");
  const iv = raw.slice(0, 12);
  const tag = raw.slice(12, 28);
  const data = raw.slice(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString("utf8");
}

