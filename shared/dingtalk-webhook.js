import "dotenv/config";

import crypto from "crypto";

const DINGTALK_SECRET = process.env.DINGTALK_SECRET || "";
const DINGTALK_WEBHOOK = process.env.DINGTALK_WEBHOOK || "";
const enabled = process.env.ENABLE_DINGTALK === "true";


async function dingTalk(msg) {
  if (!enabled || !DINGTALK_WEBHOOK) {
    return;
  }

  let url = DINGTALK_WEBHOOK;
  if (DINGTALK_SECRET) {
    const timestamp = Date.now();
    const stringToSign = `${timestamp}\n${DINGTALK_SECRET}`;
    const sign = crypto
      .createHmac("sha256", DINGTALK_SECRET)
      .update(stringToSign)
      .digest("base64");
    const signEncoded = encodeURIComponent(sign);
    url = `${url}&timestamp=${timestamp}&sign=${signEncoded}`;
  }

  const body = {
    msgtype: "text",
    text: { content: msg },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error(`[DingTalk] Failed: ${response.statusText}`);
    }
    const responseData = await response.json();
    if (responseData.errcode) {
      console.error(`[DingTalk] Failed: ${responseData.errmsg}`);
    }
  } catch (e) {
    console.error("[DingTalk] Error sending message:", e);
  }
}

export default dingTalk;