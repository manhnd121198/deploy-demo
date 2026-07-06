// Giao diện: đăng nhập (tên + PIN) → parse JSON (client) → hẹn giờ qua Worker → xem/huỷ lịch.
// Token phiên lưu localStorage; mọi call /api có kèm Bearer token.

const $ = (id) => document.getElementById(id);
const LS_TOKEN = "coc_token";

let token = localStorage.getItem(LS_TOKEN) || "";
let account = "";
let parsed = []; // việc parse ở client, chưa gửi server
let serverTasks = []; // việc đã lên lịch trên server (giữ ở client để hiện ngay)
let speed10x = false;
let clockBaseSec = 0;
let clockBaseMs = Date.now();
let lastDisplayNow = -1;

const nowSec = () => Math.floor(Date.now() / 1000);

function resetClock() {
  clockBaseSec = nowSec();
  clockBaseMs = Date.now();
  lastDisplayNow = -1;
}

function displayNowSec() {
  const elapsedSec = (Date.now() - clockBaseMs) / 1000;
  return Math.floor(clockBaseSec + elapsedSec * (speed10x ? 10 : 1));
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3200);
}

const esc = (s) =>
  String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function authHeaders(extra) {
  const h = extra || {};
  if (token) h.Authorization = "Bearer " + token;
  return h;
}

async function apiGet(path) {
  const r = await fetch(path, { headers: authHeaders() });
  return handle(r);
}

async function apiPost(path, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  return handle(r);
}

async function handle(r) {
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) {
    logout();
    throw new Error("Phiên hết hạn, đăng nhập lại.");
  }
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

// ---- Auth ----
async function doAuth(path) {
  const name = $("acctName").value.trim();
  const pin = $("acctPin").value;
  if (!name || !pin) return toast("Nhập tên và PIN.");
  try {
    const res = await apiPost(path, { name, pin });
    token = res.token;
    account = res.name;
    localStorage.setItem(LS_TOKEN, token);
    $("acctPin").value = "";
    await enterApp();
  } catch (e) {
    toast(e.message);
  }
}

function logout() {
  token = "";
  account = "";
  localStorage.removeItem(LS_TOKEN);
  speed10x = false;
  $("speed10x").checked = false;
  resetClock();
  $("appView").hidden = true;
  $("loginView").hidden = false;
}

async function enterApp() {
  $("loginView").hidden = true;
  $("appView").hidden = false;
  parsed = [];
  renderParsed();
  const acct = await apiGet("/api/account"); // xác thực token + lấy webhook đã lưu
  account = acct.name;
  $("who").textContent = account;
  $("webhook").value = acct.webhookUrl || "";
  $("json").value = acct.json || "";
  await loadServer();
}

// ---- Bảng ----
function renderTable(tbodyId, rows, onDelete) {
  const now = displayNowSec();
  const tbody = $(tbodyId);
  tbody.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td>${esc(row.label)}</td><td>${remaining(row.finishAt, now)}</td><td>${finishClock(row.finishAt)}</td>`;
    const td = document.createElement("td");
    const btn = document.createElement("button");
    btn.className = "icon";
    btn.textContent = "✕";
    btn.title = "Xoá";
    btn.onclick = () => onDelete(row);
    td.appendChild(btn);
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

function renderParsed() {
  renderTable("parsedBody", parsed, (row) => {
    parsed = parsed.filter((x) => x.id !== row.id);
    renderParsed();
  });
  $("parsedCount").textContent = parsed.length;
  $("parsedCard").hidden = parsed.length === 0;
}

function doParse() {
  const jsonText = $("json").value;
  saveJson(jsonText);
  try {
    parsed = parseVillage(jsonText, nowSec());
    renderParsed();
    if (parsed.length === 0) toast("Không có việc nào đang chạy.");
  } catch (e) {
    parsed = [];
    renderParsed();
    toast("Dữ liệu không hợp lệ: " + e.message);
  }
}

function renderServer() {
  serverTasks.sort((a, b) => a.finishAt - b.finishAt);
  renderTable("serverBody", serverTasks, async (row) => {
    try {
      await apiPost("/api/cancel", { key: row.key });
      serverTasks = serverTasks.filter((x) => x.key !== row.key);
      renderServer();
    } catch (e) {
      toast("Không huỷ được: " + e.message);
    }
  });
  $("serverCount").textContent = serverTasks.length;
}

async function loadServer() {
  try {
    const res = await apiGet("/api/tasks");
    serverTasks = res.tasks || [];
    renderServer();
  } catch (e) {
    toast(e.message);
  }
}

async function scheduleAll() {
  const webhook = $("webhook").value.trim();
  if (!webhook) return toast("Hãy nhập Google Chat webhook URL.");
  if (parsed.length === 0) return toast("Chưa có việc nào để đặt.");
  const tasks = parsed.map((t) => ({
    finishAt: t.finishAt,
    label: t.label,
    text: `${t.label} đã xong! (${finishClock(t.finishAt)})`,
  }));
  try {
    const res = await apiPost("/api/schedule", { webhookUrl: webhook, tasks });
    // API thay toàn bộ lịch cũ bằng lịch mới; dùng kết quả trả về để hiện ngay.
    serverTasks = res.tasks || [];
    renderServer();
    toast(`Đã thay ${res.replaced || 0} lịch cũ và đặt ${res.scheduled} lịch mới.`);
  } catch (e) {
    toast("Lỗi đặt lịch: " + e.message);
  }
}

async function cancelAll() {
  if (!confirm("Huỷ tất cả tin nhắn đã lên lịch của tài khoản này?")) return;
  try {
    await apiPost("/api/cancel", { all: true });
    serverTasks = [];
    renderServer();
    toast("Đã huỷ tất cả.");
  } catch (e) {
    toast("Không huỷ được: " + e.message);
  }
}

// Gửi 1 tin thử tới webhook để kiểm tra.
async function testWebhook() {
  const webhook = $("webhook").value.trim();
  if (!webhook) return toast("Hãy nhập Google Chat webhook URL.");
  toast("Đang gửi tin thử...");
  try {
    await apiPost("/api/test-webhook", { webhookUrl: webhook });
    toast("Đã gửi! Kiểm tra Google Chat xem có tin thử chưa.");
  } catch (e) {
    toast("Test lỗi: " + e.message);
  }
}

// Lưu webhook về server khi người dùng đổi (để lần sau tự điền).
async function saveWebhook() {
  if (!token) return;
  try {
    await apiPost("/api/account", { webhookUrl: $("webhook").value.trim() });
  } catch {
    /* im lặng: sẽ lưu lại khi đặt lịch */
  }
}

// Lưu JSON về server (theo tài khoản) để đăng nhập máy khác vẫn còn.
async function saveJson(jsonText) {
  if (!token) return;
  try {
    await apiPost("/api/account", { json: jsonText });
  } catch {
    /* im lặng */
  }
}

// Xóa toàn bộ JSON: rỗng ô nhập + danh sách parse + xóa bản lưu server.
function clearJson() {
  $("json").value = "";
  parsed = [];
  renderParsed();
  saveJson("");
  toast("Đã xóa JSON.");
}

function renderCountdowns() {
  if (!$("appView").hidden) {
    const now = displayNowSec();
    if (now === lastDisplayNow) return;
    lastDisplayNow = now;
    renderParsed();
    renderServer();
  }
}

// ---- Wire ----
$("loginBtn").onclick = () => doAuth("/api/login");
$("registerBtn").onclick = () => doAuth("/api/register");
$("logoutBtn").onclick = logout;
$("parseBtn").onclick = doParse;
$("reloadBtn").onclick = doParse;
$("scheduleBtn").onclick = scheduleAll;
$("refreshBtn").onclick = loadServer;
$("cancelAllBtn").onclick = cancelAll;
$("webhook").onchange = saveWebhook;
$("json").onchange = () => saveJson($("json").value);
$("clearJsonBtn").onclick = clearJson;
$("testWebhookBtn").onclick = testWebhook;
$("speed10x").onchange = () => {
  speed10x = $("speed10x").checked;
  resetClock();
  renderCountdowns();
};
resetClock();
setInterval(renderCountdowns, 100);

// Tự vào app nếu còn token hợp lệ.
if (token) {
  enterApp().catch(() => logout());
}
