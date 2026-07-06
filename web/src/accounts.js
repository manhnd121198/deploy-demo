// Tài khoản (tên + PIN) lưu trong KV: khoá "acct:<name>".
// Mỗi tài khoản giữ webhook riêng + (gián tiếp) danh sách task riêng.

import { hashPin, verifyPin, normalizeName } from "./auth.js";

const ACCT_PREFIX = "acct:";

export async function register(env, rawName, pin) {
  const name = normalizeName(rawName);
  requirePin(pin);
  if (await env.TASKS.get(ACCT_PREFIX + name)) {
    throw new Error("Tên đã tồn tại, hãy đăng nhập");
  }
  const { salt, hash } = await hashPin(pin);
  const acct = { salt, hash, webhookUrl: "", createdAt: Math.floor(Date.now() / 1000) };
  await env.TASKS.put(ACCT_PREFIX + name, JSON.stringify(acct));
  return name;
}

export async function login(env, rawName, pin) {
  const name = normalizeName(rawName);
  requirePin(pin);
  const acct = await env.TASKS.get(ACCT_PREFIX + name, "json");
  if (!acct || !(await verifyPin(pin, acct.salt, acct.hash))) {
    throw new Error("Sai tên hoặc PIN");
  }
  return name;
}

export async function getAccount(env, name) {
  const acct = await load(env, name);
  return { name, webhookUrl: acct.webhookUrl || "", json: acct.json || "" };
}

// Cập nhật từng phần: chỉ ghi field nào được truyền (webhookUrl / json).
export async function updateAccount(env, name, fields) {
  const acct = await load(env, name);
  if (typeof fields.webhookUrl === "string") acct.webhookUrl = fields.webhookUrl;
  if (typeof fields.json === "string") acct.json = fields.json.slice(0, 200000);
  await env.TASKS.put(ACCT_PREFIX + name, JSON.stringify(acct));
}

async function load(env, name) {
  const acct = await env.TASKS.get(ACCT_PREFIX + name, "json");
  if (!acct) throw new Error("Tài khoản không tồn tại");
  return acct;
}

function requirePin(pin) {
  if (!/^.{4,32}$/.test(String(pin || ""))) throw new Error("PIN dài 4-32 ký tự");
}
