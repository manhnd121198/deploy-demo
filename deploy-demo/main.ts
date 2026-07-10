const enc = new TextEncoder();
const dec = new TextDecoder();
const kv = await Deno.openKv();

const GOOGLE_CHAT_RE = /^https:\/\/chat\.googleapis\.com\//;
const MAX_ATTEMPTS = 3;
const BUCKET_LOOKBACK_MINUTES = 30;

type Account = {
  salt: string;
  hash: string;
  webhookUrl?: string;
  json?: string;
  createdAt: number;
};

type Task = {
  key: string;
  name: string;
  label: string;
  finishAt: number;
  text: string;
  webhookUrl: string;
  attempts: number;
  bucket: number;
};

type PublicTask = {
  key: string;
  label: string;
  finishAt: number;
};

Deno.cron("dispatch Google Chat tasks", "* * * * *", dispatchDue);

Deno.serve(async (request) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return handleApi(request, url);
  return serveStatic(url);
});

async function handleApi(request: Request, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  try {
    const secret = Deno.env.get("AUTH_SECRET");
    if (!secret) throw new Error("Server chưa cấu hình AUTH_SECRET");

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

    if (path === "/api/account" && method === "GET") {
      return json(await getAccount(name));
    }

    if (path === "/api/account" && method === "POST") {
      const body = await request.json();
      const fields: { webhookUrl?: string; json?: string } = {};
      if ("webhookUrl" in body) fields.webhookUrl = String(body.webhookUrl || "").trim();
      if ("json" in body) fields.json = String(body.json || "");
      await updateAccount(name, fields);
      return json({ ok: true });
    }

    if (path === "/api/test-webhook" && method === "POST") {
      const { webhookUrl } = await request.json();
      const result = await testWebhook(webhookUrl);
      await updateAccount(name, { webhookUrl: String(webhookUrl || "").trim() });
      return json(result);
    }

    if (path === "/api/tasks" && method === "GET") {
      return json(await listTasks(name));
    }

    if (path === "/api/schedule" && method === "POST") {
      const body = await request.json();
      const result = await schedule(name, body);
      await updateAccount(name, { webhookUrl: String(body.webhookUrl || "").trim() });
      return json(result);
    }

    if (path === "/api/cancel" && method === "POST") {
      return json(await cancel(name, await request.json()));
    }

    return json({ error: "Not found" }, 404);
  } catch (e) {
    return json({ error: errorMessage(e) }, 400);
  }
}

async function register(rawName: unknown, pin: unknown): Promise<string> {
  const name = normalizeName(rawName);
  requirePin(pin);
  const existing = await kv.get<Account>(["acct", name]);
  if (existing.value) throw new Error("Tên đã tồn tại, hãy đăng nhập");

  const { salt, hash } = await hashPin(String(pin));
  await kv.set(["acct", name], {
    salt,
    hash,
    webhookUrl: "",
    json: "",
    createdAt: Math.floor(Date.now() / 1000),
  } satisfies Account);
  return name;
}

async function login(rawName: unknown, pin: unknown): Promise<string> {
  const name = normalizeName(rawName);
  requirePin(pin);
  const acct = await loadAccount(name);
  if (!(await verifyPin(String(pin), acct.salt, acct.hash))) {
    throw new Error("Sai tên hoặc PIN");
  }
  return name;
}

async function getAccount(name: string) {
  const acct = await loadAccount(name);
  return { name, webhookUrl: acct.webhookUrl || "", json: acct.json || "" };
}

async function updateAccount(
  name: string,
  fields: { webhookUrl?: string; json?: string },
): Promise<void> {
  const acct = await loadAccount(name);
  if (typeof fields.webhookUrl === "string") acct.webhookUrl = fields.webhookUrl;
  if (typeof fields.json === "string") acct.json = fields.json.slice(0, 200000);
  await kv.set(["acct", name], acct);
}

async function loadAccount(name: string): Promise<Account> {
  const acct = await kv.get<Account>(["acct", name]);
  if (!acct.value) throw new Error("Tài khoản không tồn tại");
  return acct.value;
}

async function schedule(name: string, body: any) {
  const webhookUrl = String(body.webhookUrl || "").trim();
  if (!webhookUrl) throw new Error("Thiếu webhookUrl");
  if (!GOOGLE_CHAT_RE.test(webhookUrl)) {
    throw new Error("webhookUrl phải là Google Chat incoming webhook");
  }

  const pending: Array<{ finishAt: number; text: string; label: string }> = [];
  const inputTasks = Array.isArray(body.tasks) ? body.tasks : [];
  for (const t of inputTasks) {
    const finishAt = Number(t.finishAt);
    const text = String(t.text || "").slice(0, 4000);
    const label = String(t.label || "Việc").slice(0, 200);
    if (!Number.isFinite(finishAt) || finishAt <= 0 || !text) continue;
    pending.push({ finishAt, text, label });
  }

  const oldTasks = await loadIndex(name);
  const created: Task[] = pending.map((t) => ({
    key: `task:${name}:${crypto.randomUUID()}`,
    name,
    label: t.label,
    finishAt: t.finishAt,
    text: t.text,
    webhookUrl,
    attempts: 0,
    bucket: bucketFor(t.finishAt),
  }));

  await replaceBuckets(oldTasks, created);
  await saveIndex(name, created);
  return {
    scheduled: created.length,
    replaced: oldTasks.length,
    tasks: created.map(toPublicTask),
  };
}

async function listTasks(name: string): Promise<{ tasks: PublicTask[] }> {
  const tasks = (await loadIndex(name)).map(toPublicTask);
  tasks.sort((a, b) => a.finishAt - b.finishAt);
  return { tasks };
}

async function cancel(name: string, body: any): Promise<{ cancelled: number }> {
  const tasks = await loadIndex(name);
  if (body.all) {
    await removeFromBuckets(tasks);
    await saveIndex(name, []);
    return { cancelled: tasks.length };
  }

  const key = String(body.key || "");
  const task = tasks.find((t) => t.key === key);
  if (!task || !key.startsWith(`task:${name}:`)) throw new Error("key không hợp lệ");
  await removeFromBuckets([task]);
  await saveIndex(name, tasks.filter((t) => t.key !== key));
  return { cancelled: 1 };
}

async function testWebhook(webhookUrl: unknown): Promise<{ ok: true }> {
  const url = String(webhookUrl || "").trim();
  if (!GOOGLE_CHAT_RE.test(url)) {
    throw new Error("webhookUrl phải là Google Chat incoming webhook");
  }
  let r: Response;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ text: "Test từ CoC Builder Alarm — webhook hoạt động!" }),
    });
  } catch (e) {
    throw new Error("Không gọi được webhook: " + errorMessage(e));
  }
  if (!r.ok) throw new Error("Webhook trả về HTTP " + r.status);
  return { ok: true };
}

async function dispatchDue(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const currentBucket = bucketFor(now);
  for (let bucket = currentBucket - BUCKET_LOOKBACK_MINUTES; bucket <= currentBucket; bucket++) {
    const tasks = await loadBucket(bucket);
    if (tasks.length === 0) continue;

    const keep: Task[] = [];
    for (const task of tasks) {
      if (task.finishAt > now) {
        keep.push(task);
        continue;
      }

      if (await sendWebhook(task.webhookUrl, task.text)) {
        await removeFromIndex(task.name, task.key);
      } else {
        task.attempts = (task.attempts || 0) + 1;
        if (task.attempts >= MAX_ATTEMPTS) {
          await removeFromIndex(task.name, task.key);
        } else {
          keep.push(task);
        }
      }
    }
    await saveBucket(bucket, keep);
  }
}

async function loadIndex(name: string): Promise<Task[]> {
  const data = await kv.get<{ tasks: Task[] }>(["task_index", name]);
  return Array.isArray(data.value?.tasks) ? data.value.tasks : [];
}

async function saveIndex(name: string, tasks: Task[]): Promise<void> {
  if (tasks.length === 0) {
    await kv.delete(["task_index", name]);
    return;
  }
  await kv.set(["task_index", name], { tasks: tasks.map(toStoredTask) });
}

async function removeFromIndex(name: string, key: string): Promise<void> {
  const tasks = await loadIndex(name);
  await saveIndex(name, tasks.filter((t) => t.key !== key));
}

async function loadBucket(bucket: number): Promise<Task[]> {
  const data = await kv.get<{ tasks: Task[] }>(["due", bucket]);
  return Array.isArray(data.value?.tasks) ? data.value.tasks : [];
}

async function saveBucket(bucket: number, tasks: Task[]): Promise<void> {
  if (tasks.length === 0) {
    await kv.delete(["due", bucket]);
    return;
  }
  await kv.set(["due", bucket], { tasks: tasks.map(toStoredTask) });
}

async function replaceBuckets(oldTasks: Task[], newTasks: Task[]): Promise<void> {
  const oldByBucket = groupByBucket(oldTasks);
  const newByBucket = groupByBucket(newTasks);
  const buckets = new Set([...oldByBucket.keys(), ...newByBucket.keys()]);
  for (const bucket of buckets) {
    const removeKeys = new Set((oldByBucket.get(bucket) || []).map((t) => t.key));
    const bucketTasks = newByBucket.get(bucket) || [];
    const addKeys = new Set(bucketTasks.map((t) => t.key));
    const existing = await loadBucket(bucket);
    await saveBucket(
      bucket,
      existing.filter((t) => !removeKeys.has(t.key) && !addKeys.has(t.key)).concat(bucketTasks),
    );
  }
}

async function removeFromBuckets(tasks: Task[]): Promise<void> {
  const byBucket = groupByBucket(tasks);
  for (const [bucket, bucketTasks] of byBucket) {
    const removeKeys = new Set(bucketTasks.map((t) => t.key));
    const existing = await loadBucket(bucket);
    await saveBucket(bucket, existing.filter((t) => !removeKeys.has(t.key)));
  }
}

function groupByBucket(tasks: Task[]): Map<number, Task[]> {
  const out = new Map<number, Task[]>();
  for (const task of tasks) {
    const bucket = task.bucket ?? bucketFor(task.finishAt);
    if (!out.has(bucket)) out.set(bucket, []);
    out.get(bucket)!.push({ ...task, bucket });
  }
  return out;
}

function bucketFor(finishAt: number): number {
  return Math.floor(Number(finishAt) / 60);
}

function toPublicTask(task: Task): PublicTask {
  return { key: task.key, label: task.label, finishAt: task.finishAt };
}

function toStoredTask(task: Task): Task {
  return {
    key: task.key,
    name: task.name,
    label: task.label,
    finishAt: task.finishAt,
    text: task.text,
    webhookUrl: task.webhookUrl,
    attempts: task.attempts || 0,
    bucket: task.bucket ?? bucketFor(task.finishAt),
  };
}

async function sendWebhook(webhookUrl: string, text: string): Promise<boolean> {
  try {
    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ text }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function normalizeName(raw: unknown): string {
  const name = String(raw || "").trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,32}$/.test(name)) {
    throw new Error("Tên chỉ gồm a-z, 0-9, _ , - và dài 3-32 ký tự");
  }
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
  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    b64urlDecode(sig),
    enc.encode(body),
  );
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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=UTF-8" },
  });
}

async function serveStatic(url: URL): Promise<Response> {
  const path = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  if (!path || path.includes("..")) return new Response("Not found", { status: 404 });

  try {
    const file = await Deno.readFile(new URL(`./public/${path}`, import.meta.url));
    return new Response(file, { headers: { "Content-Type": contentType(path) } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function contentType(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=UTF-8";
  if (path.endsWith(".js")) return "application/javascript; charset=UTF-8";
  if (path.endsWith(".css")) return "text/css; charset=UTF-8";
  return "application/octet-stream";
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function toHex(buf: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const a = new Uint8Array(hex.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16);
  return a;
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const base64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}
