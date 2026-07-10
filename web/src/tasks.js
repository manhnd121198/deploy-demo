// Task đã hẹn giờ lưu trong KV theo 2 index:
// - "task_index:<name>" để UI list/cancel theo tài khoản.
// - "due:<minute>" để cron đọc thẳng bucket tới hạn, không KV.list mỗi phút.

const GOOGLE_CHAT_RE = /^https:\/\/chat\.googleapis\.com\//;
const MAX_ATTEMPTS = 3;
const BUCKET_LOOKBACK_MINUTES = 3;

const taskPrefix = (name) => `task:${name}:`;
const taskIndexKey = (name) => `task_index:${name}`;
const bucketFor = (finishAt) => Math.floor(Number(finishAt) / 60);
const bucketKey = (bucket) => `due:${bucket}`;

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

  const oldTasks = await loadIndex(env, name);

  const created = [];
  for (const t of pending) {
    const key = taskPrefix(name) + crypto.randomUUID();
    created.push({
      key,
      name,
      label: t.label,
      finishAt: t.finishAt,
      text: t.text,
      webhookUrl,
      attempts: 0,
      bucket: bucketFor(t.finishAt),
    });
  }
  await replaceBuckets(env, oldTasks, created);
  await saveIndex(env, name, created);
  return {
    scheduled: created.length,
    replaced: oldTasks.length,
    tasks: created.map(toPublicTask),
  };
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
  const out = (await loadIndex(env, name)).map(toPublicTask);
  out.sort((a, b) => a.finishAt - b.finishAt);
  return { tasks: out };
}

export async function cancel(env, name, body) {
  const tasks = await loadIndex(env, name);
  if (body.all) {
    await removeFromBuckets(env, tasks);
    await saveIndex(env, name, []);
    return { cancelled: tasks.length };
  }
  const key = String(body.key || "");
  const task = tasks.find((t) => t.key === key);
  if (!task || !key.startsWith(taskPrefix(name))) throw new Error("key không hợp lệ"); // chặn xoá chéo tài khoản
  await removeFromBuckets(env, [task]);
  await saveIndex(env, name, tasks.filter((t) => t.key !== key));
  return { cancelled: 1 };
}

// Cron: đọc các bucket phút gần hiện tại, gửi task tới hạn, rồi xoá khỏi bucket/index.
export async function dispatchDue(env) {
  const now = Math.floor(Date.now() / 1000);
  const currentBucket = bucketFor(now);
  for (let bucket = currentBucket - BUCKET_LOOKBACK_MINUTES; bucket <= currentBucket; bucket++) {
    const tasks = await loadBucket(env, bucket);
    if (tasks.length === 0) continue;

    const keep = [];
    for (const task of tasks) {
      if (!task || task.finishAt > now) {
        keep.push(task);
        continue;
      }

      if (await sendWebhook(task.webhookUrl, task.text)) {
        await removeFromIndex(env, task.name, task.key);
      } else {
        task.attempts = (task.attempts || 0) + 1;
        if (task.attempts >= MAX_ATTEMPTS) {
          await removeFromIndex(env, task.name, task.key);
        } else {
          keep.push(task);
        }
      }
    }
    await saveBucket(env, bucket, keep);
  }
}

async function loadIndex(env, name) {
  const data = await env.TASKS.get(taskIndexKey(name), "json");
  return Array.isArray(data?.tasks) ? data.tasks : [];
}

async function saveIndex(env, name, tasks) {
  if (tasks.length === 0) {
    await env.TASKS.delete(taskIndexKey(name));
    return;
  }
  const summaries = tasks.map(toStoredTask);
  await env.TASKS.put(taskIndexKey(name), JSON.stringify({ tasks: summaries }));
}

async function removeFromIndex(env, name, key) {
  const tasks = await loadIndex(env, name);
  await saveIndex(env, name, tasks.filter((t) => t.key !== key));
}

async function loadBucket(env, bucket) {
  const data = await env.TASKS.get(bucketKey(bucket), "json");
  return Array.isArray(data?.tasks) ? data.tasks : [];
}

async function saveBucket(env, bucket, tasks) {
  const key = bucketKey(bucket);
  if (tasks.length === 0) {
    await env.TASKS.delete(key);
    return;
  }
  const expiresAt = Math.max(...tasks.map((t) => Math.floor(t.finishAt))) + 86400;
  await env.TASKS.put(key, JSON.stringify({ tasks: tasks.map(toStoredTask) }), { expiration: expiresAt });
}

async function replaceBuckets(env, oldTasks, newTasks) {
  const oldByBucket = groupByBucket(oldTasks);
  const newByBucket = groupByBucket(newTasks);
  const buckets = new Set([...oldByBucket.keys(), ...newByBucket.keys()]);
  for (const bucketText of buckets) {
    const bucket = Number(bucketText);
    const removeKeys = new Set((oldByBucket.get(bucketText) || []).map((t) => t.key));
    const bucketTasks = newByBucket.get(bucketText) || [];
    const existing = await loadBucket(env, bucket);
    const keys = new Set(bucketTasks.map((t) => t.key));
    await saveBucket(
      env,
      bucket,
      existing.filter((t) => !removeKeys.has(t.key) && !keys.has(t.key)).concat(bucketTasks)
    );
  }
}

async function removeFromBuckets(env, tasks) {
  const byBucket = groupByBucket(tasks);
  for (const [bucketText, bucketTasks] of byBucket) {
    const bucket = Number(bucketText);
    const removeKeys = new Set(bucketTasks.map((t) => t.key));
    const existing = await loadBucket(env, bucket);
    await saveBucket(env, bucket, existing.filter((t) => !removeKeys.has(t.key)));
  }
}

function groupByBucket(tasks) {
  const out = new Map();
  for (const task of tasks) {
    const bucket = task.bucket ?? bucketFor(task.finishAt);
    if (!out.has(bucket)) out.set(bucket, []);
    out.get(bucket).push({ ...task, bucket });
  }
  return out;
}

function toPublicTask(task) {
  return { key: task.key, label: task.label, finishAt: task.finishAt };
}

function toStoredTask(task) {
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
