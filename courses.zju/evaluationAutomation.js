#!/usr/bin/env node

import { ZJUAM, ZDBK } from "login-zju";
import "dotenv/config";

export function getCredentials() {
  const username = process.env.ZJU_USERNAME;
  const password = process.env.ZJU_PASSWORD;

  if (!username || !password) {
    throw new Error("Missing ZJU_USERNAME or ZJU_PASSWORD in .env");
  }

  return { username, password };
}

export function createZdbkClient() {
  const { username, password } = getCredentials();
  return {
    username,
    zdbk: new ZDBK(new ZJUAM(username, password)),
  };
}

export async function fetchEvaluationBootstrapUrl(zdbk, username) {
  const checkUrl =
    `https://zdbk.zju.edu.cn/jwglxt/xtgl/index_cxMyCosJxpj.html?` +
    `doType=query&gnmkdm=N508301&su=${username}`;

  const response = await zdbk.fetch(checkUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: "",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch evaluation bootstrap URL: HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.status !== "success" || typeof payload?.result !== "string") {
    throw new Error(`Unexpected bootstrap payload: ${JSON.stringify(payload)}`);
  }

  return payload.result;
}

export function decodeJwtPayload(token) {
  if (!token) return null;
  const [, payload] = token.split(".");
  if (!payload) return null;

  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

function pickRadioOption(property) {
  const options = property.options || [];
  const preferredFragments = ["强烈推荐", "推荐", "非常满意", "是（跳转", "是"];

  for (const fragment of preferredFragments) {
    const match = options.find((option) => option.label?.includes(fragment));
    if (match) return match.value;
  }

  return options[0]?.value ?? null;
}

function defaultTextareaValue(title, templates) {
  if (!title) return "";
  if (title.includes("亮点") || title.includes("优点")) {
    return templates.praise;
  }
  if (title.includes("建议") || title.includes("改进")) {
    return templates.suggestion;
  }
  return "";
}

export function buildDefaultAnswers(schema, options = {}) {
  const properties = schema?.properties || {};
  const templates = {
    praise: options.praise ?? "老师讲解清晰认真，课堂组织有条理。",
    suggestion: options.suggestion ?? "建议保持清晰讲授，并适当增加案例互动。",
  };

  const answers = {};

  for (const [field, property] of Object.entries(properties)) {
    const type = property?.type;

    if (type === "slider") {
      answers[field] = property.max ?? 5;
      continue;
    }

    if (type === "radio") {
      const picked = pickRadioOption(property);
      if (picked) answers[field] = picked;
      continue;
    }

    if (type === "textarea") {
      const value = defaultTextareaValue(property.title, templates);
      if (value) answers[field] = value;
      continue;
    }
  }

  return answers;
}

export function summarizeSchema(schema) {
  const properties = schema?.properties || {};
  return Object.entries(properties).map(([field, property]) => ({
    field,
    type: property?.type ?? null,
    title: property?.title ?? null,
    required: Boolean(schema?.required?.includes(field)),
    options:
      property?.options?.map((option) => ({
        label: option.label,
        value: option.value,
        mutex: Boolean(option.mutex),
      })) ?? null,
  }));
}
