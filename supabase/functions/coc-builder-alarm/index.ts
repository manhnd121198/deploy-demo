import { createClient } from "npm:@supabase/supabase-js@2";

const enc = new TextEncoder();
const dec = new TextDecoder();

const GOOGLE_CHAT_RE = /^https:\/\/chat\.googleapis\.com\//;
const MAX_ATTEMPTS = 3;
const MAX_DISPATCH = 100;

type Account = {
  name: string;
  salt: string;
  hash: string;
  channel: "google" | "telegram";
  webhook_url: string;
  telegram_bot_token: string;
  telegram_chat_id: string;
  json_data: string;
  created_at: number;
};

type Task = {
  key: string;
  name: string;
  label: string;
  finish_at: number;
  text: string;
  channel: "google" | "telegram";
  webhook_url: string;
  telegram_bot_token: string;
  telegram_chat_id: string;
  attempts: number;
  created_at: number;
};

type PublicTask = {
  key: string;
  label: string;
  finishAt: number;
};

const supabase = createClient(
  requireEnv("PROJECT_URL"),
  requireEnv("SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  const url = new URL(request.url);
  try {
    if (url.pathname.endsWith("/dispatch")) {
      requireDispatchAuth(request);
      return json(await dispatchDue());
    }

    const apiIndex = url.pathname.indexOf("/api/");
    if (apiIndex < 0) return json({ error: "Not found" }, 404);
    return await handleApi(request, url.pathname.slice(apiIndex));
  } catch (e) {
    return json({ error: errorMessage(e) }, 400);
  }
});

async function handleApi(request: Request, path: string): Promise<Response> {
  const method = request.method;
  const secret = requireEnv("AUTH_SECRET");

  if (path === "/api/debug/all" && method === "GET") {
    requireAdmin(request);
    return json(await debugAll());
  }

  if (path === "/api/register" && method === "POST") {
    const { name, pin } = await request.json();
    const acct = await register(name, pin);
    return json({ name: acct, token: await signToken(acct, secret) });
  }

  if (path === "/api/login" && method === "POST") {
    const { name, pin } = await request.json();
    const acct = await login(name, pin);
    return json({ name: acct, token: await signToken(acct, secret) });
  }

  const name = await verifyToken(bearer(request), secret);
  if (!name) return json({ error: "Chưa đăng nhập" }, 401);

  if (path === "/api/account" && method === "GET") return json(await getAccount(name));

  if (path === "/api/account" && method === "POST") {
    const body = await request.json();
    const fields: AccountFields = {};
    if ("channel" in body) fields.channel = parseChannel(body.channel);
    if ("webhookUrl" in body) fields.webhookUrl = String(body.webhookUrl || "").trim();
    if ("telegramBotToken" in body) fields.telegramBotToken = String(body.telegramBotToken || "").trim();
    if ("telegramChatId" in body) fields.telegramChatId = String(body.telegramChatId || "").trim();
    if ("json" in body) fields.json = String(body.json || "");
    await updateAccount(name, fields);
    return json({ ok: true });
  }

  if (path === "/api/test-webhook" && method === "POST") {
    const body = await request.json();
    const result = await testChannel(body);
    await updateAccount(name, accountFieldsFromBody(body));
    return json(result);
  }

  if (path === "/api/tasks" && method === "GET") return json(await listTasks(name));
  if (path === "/api/debug/me" && method === "GET") return json(await debugMe(name));

  if (path === "/api/schedule" && method === "POST") {
    const body = await request.json();
    const result = await schedule(name, body);
    await updateAccount(name, accountFieldsFromBody(body));
    return json(result);
  }

  if (path === "/api/cancel" && method === "POST") return json(await cancel(name, await request.json()));

  return json({ error: "Not found" }, 404);
}

async function register(rawName: unknown, pin: unknown): Promise<string> {
  const name = normalizeName(rawName);
  requirePin(pin);
  const existing = await dbOne<Account>("accounts", "name", name);
  if (existing) throw new Error("Tên đã tồn tại, hãy đăng nhập");

  const { salt, hash } = await hashPin(String(pin));
  await dbInsert("accounts", {
    name,
    salt,
    hash,
    channel: "google",
    webhook_url: "",
    telegram_bot_token: "",
    telegram_chat_id: "",
    json_data: "",
    created_at: Math.floor(Date.now() / 1000),
  });
  return name;
}

async function login(rawName: unknown, pin: unknown): Promise<string> {
  const name = normalizeName(rawName);
  requirePin(pin);
  const acct = await loadAccount(name);
  if (!(await verifyPin(String(pin), acct.salt, acct.hash))) throw new Error("Sai tên hoặc PIN");
  return name;
}

async function getAccount(name: string) {
  const acct = await loadAccount(name);
  return {
    name,
    channel: acct.channel || "google",
    webhookUrl: acct.webhook_url || "",
    telegramBotToken: acct.telegram_bot_token || "",
    telegramChatId: acct.telegram_chat_id || "",
    json: acct.json_data || "",
  };
}

type AccountFields = {
  channel?: "google" | "telegram";
  webhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  json?: string;
};

async function updateAccount(name: string, fields: AccountFields): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (typeof fields.channel === "string") patch.channel = fields.channel;
  if (typeof fields.webhookUrl === "string") patch.webhook_url = fields.webhookUrl;
  if (typeof fields.telegramBotToken === "string") patch.telegram_bot_token = fields.telegramBotToken;
  if (typeof fields.telegramChatId === "string") patch.telegram_chat_id = fields.telegramChatId;
  if (typeof fields.json === "string") patch.json_data = fields.json.slice(0, 200000);
  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase.from("accounts").update(patch).eq("name", name);
  if (error) throw new Error(error.message);
}

async function loadAccount(name: string): Promise<Account> {
  const acct = await dbOne<Account>("accounts", "name", name);
  if (!acct) throw new Error("Tài khoản không tồn tại");
  return acct;
}

async function schedule(name: string, body: any) {
  const target = parseTarget(body);
  const inputTasks = Array.isArray(body.tasks) ? body.tasks : [];
  const created: Task[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const t of inputTasks) {
    const finishAt = Number(t.finishAt);
    const text = String(t.text || "").slice(0, 4000);
    const label = String(t.label || "Việc").slice(0, 200);
    if (!Number.isFinite(finishAt) || finishAt <= 0 || !text) continue;
    created.push({
      key: `task:${name}:${crypto.randomUUID()}`,
      name,
      label,
      finish_at: finishAt,
      text,
      channel: target.channel,
      webhook_url: target.webhookUrl,
      telegram_bot_token: target.telegramBotToken,
      telegram_chat_id: target.telegramChatId,
      attempts: 0,
      created_at: now,
    });
  }

  const oldTasks = await loadTasks(name);
  await deleteTasksByName(name);
  if (created.length > 0) await dbInsert("tasks", created);
  return {
    scheduled: created.length,
    replaced: oldTasks.length,
    tasks: created.map(toPublicTask),
  };
}

async function listTasks(name: string): Promise<{ tasks: PublicTask[] }> {
  const tasks = (await loadTasks(name)).map(toPublicTask);
  tasks.sort((a, b) => a.finishAt - b.finishAt);
  return { tasks };
}

async function debugMe(name: string) {
  const acct = await loadAccount(name);
  const tasks = (await loadTasks(name)).map((task) => ({
    key: task.key,
    label: task.label,
    finishAt: task.finish_at,
    channel: task.channel || "google",
    attempts: task.attempts || 0,
  }));
  tasks.sort((a, b) => a.finishAt - b.finishAt);

  return {
    account: {
      name,
      channel: acct.channel || "google",
      webhookUrl: maskSecret(acct.webhook_url || ""),
      telegramBotToken: maskSecret(acct.telegram_bot_token || ""),
      telegramChatId: acct.telegram_chat_id || "",
      jsonLength: (acct.json_data || "").length,
      createdAt: acct.created_at,
    },
    tasks,
  };
}

async function debugAll() {
  const { data: accounts, error: accountError } = await supabase
    .from("accounts")
    .select("*")
    .order("name", { ascending: true });
  if (accountError) throw new Error(accountError.message);

  const { data: tasks, error: taskError } = await supabase
    .from("tasks")
    .select("*")
    .order("finish_at", { ascending: true });
  if (taskError) throw new Error(taskError.message);

  return {
    accounts: (accounts || []).map((acct: Account) => ({
      name: acct.name,
      channel: acct.channel || "google",
      webhookUrl: maskSecret(acct.webhook_url || ""),
      telegramBotToken: maskSecret(acct.telegram_bot_token || ""),
      telegramChatId: acct.telegram_chat_id || "",
      jsonLength: (acct.json_data || "").length,
      createdAt: acct.created_at,
    })),
    tasks: (tasks || []).map((task: Task) => ({
      key: task.key,
      name: task.name,
      label: task.label,
      finishAt: task.finish_at,
      channel: task.channel || "google",
      attempts: task.attempts || 0,
    })),
  };
}

async function cancel(name: string, body: any): Promise<{ cancelled: number }> {
  if (body.all) {
    const oldTasks = await loadTasks(name);
    await deleteTasksByName(name);
    return { cancelled: oldTasks.length };
  }

  const key = String(body.key || "");
  if (!key.startsWith(`task:${name}:`)) throw new Error("key không hợp lệ");
  const { data, error } = await supabase.from("tasks").delete().eq("name", name).eq("key", key).select("key");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("key không hợp lệ");
  return { cancelled: data.length };
}

async function testChannel(body: any): Promise<{ ok: true }> {
  const target = parseTarget(body);
  await sendTarget(target, "Test từ CoC Builder Alarm - kênh gửi hoạt động!");
  return { ok: true };
}

async function dispatchDue(): Promise<{ checked: number; sent: number; failed: number; deleted: number }> {
  const now = Math.floor(Date.now() / 1000);
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .lte("finish_at", now)
    .order("finish_at", { ascending: true })
    .limit(MAX_DISPATCH);
  if (error) throw new Error(error.message);

  let sent = 0;
  let failed = 0;
  let deleted = 0;
  for (const task of (data || []) as Task[]) {
    if (await sendTask(task)) {
      sent += 1;
      await deleteTask(task.key);
      deleted += 1;
      continue;
    }

    const attempts = (task.attempts || 0) + 1;
    failed += 1;
    if (attempts >= MAX_ATTEMPTS) {
      await deleteTask(task.key);
      deleted += 1;
    } else {
      const { error: updateError } = await supabase.from("tasks").update({ attempts }).eq("key", task.key);
      if (updateError) throw new Error(updateError.message);
    }
  }

  return { checked: (data || []).length, sent, failed, deleted };
}

async function loadTasks(name: string): Promise<Task[]> {
  const { data, error } = await supabase.from("tasks").select("*").eq("name", name).order("finish_at");
  if (error) throw new Error(error.message);
  return (data || []) as Task[];
}

async function deleteTasksByName(name: string): Promise<void> {
  const { error } = await supabase.from("tasks").delete().eq("name", name);
  if (error) throw new Error(error.message);
}

async function deleteTask(key: string): Promise<void> {
  const { error } = await supabase.from("tasks").delete().eq("key", key);
  if (error) throw new Error(error.message);
}

function toPublicTask(task: Task): PublicTask {
  return { key: task.key, label: task.label, finishAt: task.finish_at };
}

function parseChannel(raw: unknown): "google" | "telegram" {
  return raw === "telegram" ? "telegram" : "google";
}

function accountFieldsFromBody(body: any): AccountFields {
  return {
    channel: parseChannel(body.channel),
    webhookUrl: String(body.webhookUrl || "").trim(),
    telegramBotToken: String(body.telegramBotToken || "").trim(),
    telegramChatId: String(body.telegramChatId || "").trim(),
  };
}

function parseTarget(body: any): {
  channel: "google" | "telegram";
  webhookUrl: string;
  telegramBotToken: string;
  telegramChatId: string;
} {
  const channel = parseChannel(body.channel);
  const webhookUrl = String(body.webhookUrl || "").trim();
  const telegramBotToken = String(body.telegramBotToken || "").trim();
  const telegramChatId = String(body.telegramChatId || "").trim();

  if (channel === "google") {
    if (!webhookUrl) throw new Error("Thiếu Google Chat webhook URL");
    if (!GOOGLE_CHAT_RE.test(webhookUrl)) throw new Error("webhookUrl phải là Google Chat incoming webhook");
  } else {
    if (!telegramBotToken) throw new Error("Thiếu Telegram bot token");
    if (!telegramChatId) throw new Error("Thiếu Telegram chat id");
  }

  return { channel, webhookUrl, telegramBotToken, telegramChatId };
}

async function sendTask(task: Task): Promise<boolean> {
  try {
    await sendTarget(
      {
        channel: task.channel || "google",
        webhookUrl: task.webhook_url,
        telegramBotToken: task.telegram_bot_token || "",
        telegramChatId: task.telegram_chat_id || "",
      },
      task.text,
    );
    return true;
  } catch {
    return false;
  }
}

async function sendTarget(
  target: {
    channel: "google" | "telegram";
    webhookUrl: string;
    telegramBotToken: string;
    telegramChatId: string;
  },
  text: string,
): Promise<void> {
  if (target.channel === "google") {
    const r = await fetch(target.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) throw new Error("Google Chat trả về HTTP " + r.status);
    return;
  }

  const r = await fetch(`https://api.telegram.org/bot${target.telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ chat_id: target.telegramChatId, text }),
  });
  if (!r.ok) throw new Error("Telegram trả về HTTP " + r.status);
}

function normalizeName(raw: unknown): string {
  const name = String(raw || "").trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,32}$/.test(name)) throw new Error("Tên chỉ gồm a-z, 0-9, _ , - và dài 3-32 ký tự");
  return name;
}

function requirePin(pin: unknown): void {
  if (!/^.{4,32}$/.test(String(pin || ""))) throw new Error("PIN dài 4-32 ký tự");
}

async function hashPin(pin: string, saltHex?: string): Promise<{ salt: string; hash: string }> {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key,
    256,
  );
  return { salt: toHex(salt), hash: toHex(bits) };
}

async function verifyPin(pin: string, saltHex: string, expectedHash: string): Promise<boolean> {
  const { hash } = await hashPin(pin, saltHex);
  return timingSafeEqual(hash, expectedHash);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function signToken(name: string, secret: string, ttlSec = 2592000): Promise<string> {
  const payload = { name, exp: Math.floor(Date.now() / 1000) + ttlSec };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

async function verifyToken(token: string, secret: string): Promise<string | null> {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), b64urlDecode(sig), enc.encode(body));
  if (!ok) return null;

  let payload: { name?: string; exp?: number };
  try {
    payload = JSON.parse(dec.decode(b64urlDecode(body)));
  } catch {
    return null;
  }
  if (!payload.name || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload.name;
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function bearer(request: Request): string {
  const h = request.headers.get("Authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

function requireAdmin(request: Request): void {
  const token = Deno.env.get("ADMIN_TOKEN");
  if (!token) throw new Error("Server chưa cấu hình ADMIN_TOKEN");
  const header = request.headers.get("X-Admin-Token") || bearer(request);
  if (header !== token) throw new Error("Không có quyền admin");
}

function requireDispatchAuth(request: Request): void {
  const token = Deno.env.get("DISPATCH_SECRET") || Deno.env.get("ADMIN_TOKEN");
  if (!token) throw new Error("Server chưa cấu hình DISPATCH_SECRET");
  const header = request.headers.get("X-Dispatch-Secret") || bearer(request);
  if (header !== token) throw new Error("Không có quyền dispatch");
}

function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 10) return "***";
  return value.slice(0, 6) + "..." + value.slice(-4);
}

function b64url(bytes: Uint8Array): string {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function b64urlDecode(s: string): Uint8Array {
  s = s.replaceAll("-", "+").replaceAll("_", "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function dbOne<T>(table: string, column: string, value: string): Promise<T | null> {
  const { data, error } = await supabase.from(table).select("*").eq(column, value).maybeSingle();
  if (error) throw new Error(error.message);
  return data as T | null;
}

async function dbInsert(table: string, value: Record<string, unknown> | Array<Record<string, unknown>>): Promise<void> {
  const { error } = await supabase.from(table).insert(value);
  if (error) throw new Error(error.message);
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-token, x-dispatch-secret",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Server chưa cấu hình ${name}`);
  return value;
}
