// Worker: phục vụ trang tĩnh (ASSETS) + API /api/*, và cron gửi Google Chat.
// Auth: đăng ký/đăng nhập bằng tên + PIN; các endpoint khác cần Bearer token.

import { register, login, getAccount, updateAccount } from "./accounts.js";
import { signToken, verifyToken } from "./auth.js";
import { schedule, listTasks, cancel, dispatchDue, testWebhook } from "./tasks.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, url);
    return env.ASSETS.fetch(request);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(dispatchDue(env));
  },
};

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;
  try {
    if (!env.AUTH_SECRET) {
      throw new Error("Server chưa cấu hình AUTH_SECRET");
    }

    // Công khai: đăng ký / đăng nhập.
    if (path === "/api/register" && method === "POST") {
      const { name, pin } = await request.json();
      const acct = await register(env, name, pin);
      return json({ name: acct, token: await signToken(acct, env.AUTH_SECRET) });
    }
    if (path === "/api/login" && method === "POST") {
      const { name, pin } = await request.json();
      const acct = await login(env, name, pin);
      return json({ name: acct, token: await signToken(acct, env.AUTH_SECRET) });
    }

    // Cần đăng nhập.
    const name = await verifyToken(bearer(request), env.AUTH_SECRET);
    if (!name) return json({ error: "Chưa đăng nhập" }, 401);

    if (path === "/api/account" && method === "GET") {
      return json(await getAccount(env, name));
    }
    if (path === "/api/account" && method === "POST") {
      const body = await request.json();
      const fields = {};
      if ("webhookUrl" in body) fields.webhookUrl = String(body.webhookUrl || "").trim();
      if ("json" in body) fields.json = String(body.json || "");
      await updateAccount(env, name, fields);
      return json({ ok: true });
    }
    if (path === "/api/test-webhook" && method === "POST") {
      const { webhookUrl } = await request.json();
      const result = await testWebhook(webhookUrl); // ném lỗi nếu hỏng
      await updateAccount(env, name, { webhookUrl: String(webhookUrl).trim() }); // lưu lại luôn
      return json(result);
    }
    if (path === "/api/tasks" && method === "GET") {
      return json(await listTasks(env, name));
    }
    if (path === "/api/schedule" && method === "POST") {
      const body = await request.json();
      const result = await schedule(env, name, body); // validate trước
      await updateAccount(env, name, { webhookUrl: String(body.webhookUrl).trim() }); // lưu webhook mới nhất
      return json(result);
    }
    if (path === "/api/cancel" && method === "POST") {
      return json(await cancel(env, name, await request.json()));
    }

    return json({ error: "Not found" }, 404);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 400);
  }
}

function bearer(request) {
  const h = request.headers.get("Authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=UTF-8" },
  });
}
