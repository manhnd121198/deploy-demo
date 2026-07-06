// Task đã hẹn giờ lưu trong KV: khoá "task:<name>:<uuid>" — namespace theo tài khoản.
// Cron quét prefix "task:" (mọi tài khoản) và gửi Google Chat khi tới hạn.

const GOOGLE_CHAT_RE = /^https:\/\/chat\.googleapis\.com\//;
const MAX_ATTEMPTS = 3;

const taskPrefix = (name) => `task:${name}:`;

export async function schedule(env, name, body) {
  const webhookUrl = String(body.webhookUrl || "").trim();
  if (!webhookUrl) throw new Error("Thiếu webhookUrl");
  if (!GOOGLE_CHAT_RE.test(webhookUrl)) {
    throw new Error("webhookUrl phải là Google Chat incoming webhook");
  }
  const tasks = Array.isArray(body.tasks) ? body.tasks : [];
  const pending = [];
  for (const t of tasks) {
    const finishAt = Number(t.finishAt);
    const text = String(t.text || "").slice(0, 4000);
    const label = String(t.label || "Việc").slice(0, 200);
    if (!Number.isFinite(finishAt) || finishAt <= 0 || !text) continue;
    pending.push({ finishAt, text, label });
  }

  let replaced = 0;
  for await (const key of listKeys(env, taskPrefix(name))) {
    await env.TASKS.delete(key);
    replaced++;
  }

  const created = [];
  for (const t of pending) {
    const key = taskPrefix(name) + crypto.randomUUID();
    await env.TASKS.put(
      key,
      JSON.stringify({ finishAt: t.finishAt, text: t.text, label: t.label, webhookUrl, attempts: 0 }),
      { expiration: Math.floor(t.finishAt) + 86400 } // tự dọn sau 1 ngày
    );
    created.push({ key, label: t.label, finishAt: t.finishAt });
  }
  return { scheduled: created.length, replaced, tasks: created };
}

// Gửi 1 tin thử ngay để kiểm tra webhook. Ném lỗi rõ ràng nếu hỏng.
export async function testWebhook(webhookUrl) {
  const url = String(webhookUrl || "").trim();
  if (!GOOGLE_CHAT_RE.test(url)) {
    throw new Error("webhookUrl phải là Google Chat incoming webhook");
  }
  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ text: "🔔 Test từ CoC Builder Alarm — webhook hoạt động!" }),
    });
  } catch (e) {
    throw new Error("Không gọi được webhook: " + ((e && e.message) || e));
  }
  if (!r.ok) throw new Error("Webhook trả về HTTP " + r.status);
  return { ok: true };
}

export async function listTasks(env, name) {
  const out = [];
  for await (const key of listKeys(env, taskPrefix(name))) {
    const v = await env.TASKS.get(key, "json");
    if (v) out.push({ key, label: v.label, finishAt: v.finishAt });
  }
  out.sort((a, b) => a.finishAt - b.finishAt);
  return { tasks: out };
}

export async function cancel(env, name, body) {
  const prefix = taskPrefix(name);
  if (body.all) {
    let n = 0;
    for await (const key of listKeys(env, prefix)) {
      await env.TASKS.delete(key);
      n++;
    }
    return { cancelled: n };
  }
  const key = String(body.key || "");
  if (!key.startsWith(prefix)) throw new Error("key không hợp lệ"); // chặn xoá chéo tài khoản
  await env.TASKS.delete(key);
  return { cancelled: 1 };
}

// Cron: gửi mọi task tới hạn của mọi tài khoản.
export async function dispatchDue(env) {
  const now = Math.floor(Date.now() / 1000);
  for await (const key of listKeys(env, "task:")) {
    const v = await env.TASKS.get(key, "json");
    if (!v || v.finishAt > now) continue;
    if (await sendWebhook(v.webhookUrl, v.text)) {
      await env.TASKS.delete(key);
    } else {
      v.attempts = (v.attempts || 0) + 1;
      if (v.attempts >= MAX_ATTEMPTS) await env.TASKS.delete(key);
      else await env.TASKS.put(key, JSON.stringify(v), { expiration: Math.floor(v.finishAt) + 86400 });
    }
  }
}

async function* listKeys(env, prefix) {
  let cursor;
  do {
    const res = await env.TASKS.list({ prefix, cursor });
    for (const k of res.keys) yield k.name;
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
}

async function sendWebhook(webhookUrl, text) {
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
