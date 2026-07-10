// Giao diện: đăng nhập (tên + PIN) → parse JSON (client) → hẹn giờ qua server → xem/huỷ lịch.
// Token phiên lưu localStorage; mọi call /api có kèm Bearer token.

const $ = (id) => document.getElementById(id);
const LS_TOKEN = "coc_token";

let token = localStorage.getItem(LS_TOKEN) || "";
let account = "";
let parsed = []; // việc parse ở client, chưa gửi server
let detailItems = [];
let serverTasks = []; // việc đã lên lịch trên server (giữ ở client để hiện ngay)
let catalog = null;
let channel = "google";
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
  const acct = await apiGet("/api/account"); // xác thực token + lấy cấu hình đã lưu
  account = acct.name;
  $("who").textContent = account;
  setChannel(acct.channel || "google");
  $("webhook").value = acct.webhookUrl || "";
  $("telegramBotToken").value = acct.telegramBotToken || "";
  $("telegramChatId").value = acct.telegramChatId || "";
  $("json").value = acct.json || "";
  await loadCatalog();
  await loadServer();
}

function setChannel(value) {
  channel = value === "telegram" ? "telegram" : "google";
  for (const input of document.querySelectorAll('input[name="channel"]')) {
    input.checked = input.value === channel;
  }
  $("googleConfig").hidden = channel !== "google";
  $("telegramConfig").hidden = channel !== "telegram";
}

// ---- Bảng ----
async function loadCatalog() {
  if (catalog) return catalog;
  try {
    catalog = await fetch("data/catalog.json?v=2").then((r) => r.json());
    $("catalogStatus").textContent = "Catalog OK";
  } catch {
    catalog = { items: {} };
    $("catalogStatus").textContent = "Không có catalog";
  }
  return catalog;
}

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
    detailItems = parseVillageItems(jsonText, catalog);
    renderParsed();
    renderDetails();
    if (parsed.length === 0) toast("Không có việc nào đang chạy.");
  } catch (e) {
    parsed = [];
    detailItems = [];
    renderParsed();
    renderDetails();
    toast("Dữ liệu không hợp lệ: " + e.message);
  }
}

function renderDetails() {
  const tbody = $("detailBody");
  tbody.innerHTML = "";
  for (const item of detailItems) {
    const tr = document.createElement("tr");
    const levelText = item.maxLevel
      ? `${item.currentLevel}/${item.maxLevel}`
      : `${item.currentLevel}/?`;
    const countText = item.count > 1 ? ` <span class="muted">x${item.count}</span>` : "";
    const nextText = item.nextLevel
      ? `Lv${item.nextLevel.level}: ${formatLevelCosts(item.nextLevel)} / ${formatDuration(item.nextLevel.timeSec)}`
      : "-";
    const runningText = item.finishAt ? finishClock(item.finishAt) : "-";
    tr.innerHTML = `
      <td>${itemNameHtml(item)}${countText}${item.matched ? "" : ' <span class="warn">raw</span>'}</td>
      <td>${esc(item.source)}</td>
      <td>${levelText}</td>
      <td>${item.remainingLevels}</td>
      <td>${esc(nextText)}</td>
      <td>${esc(formatCosts(item.costs))}<br><span class="muted">${formatDuration(item.totalTimeSec)}</span></td>
      <td>${esc(runningText)}</td>
    `;
    tbody.appendChild(tr);
  }
  $("detailCount").textContent = detailItems.length;
  $("detailCard").hidden = detailItems.length === 0;
}

function itemNameHtml(item) {
  const image = item.imageUrl
    ? `<img class="item-icon" src="${escAttr(item.imageUrl)}" alt="" loading="lazy" onerror="this.remove()" />`
    : "";
  return `<span class="item-name">${image}<span>${esc(item.displayName || item.name)}</span></span>`;
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
  const config = channelPayload();
  if (channel === "google" && !config.webhookUrl) return toast("Hãy nhập Google Chat webhook URL.");
  if (channel === "telegram" && (!config.telegramBotToken || !config.telegramChatId)) {
    return toast("Hãy nhập Telegram bot token và chat id.");
  }
  if (parsed.length === 0) return toast("Chưa có việc nào để đặt.");
  const tasks = parsed.map((t) => ({
    finishAt: t.finishAt,
    label: t.label,
    text: `${t.label} đã xong! (${finishClock(t.finishAt)})`,
  }));
  try {
    const res = await apiPost("/api/schedule", { ...config, tasks });
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

// Gửi 1 tin thử tới kênh đang chọn để kiểm tra.
async function testWebhook() {
  const config = channelPayload();
  if (channel === "google" && !config.webhookUrl) return toast("Hãy nhập Google Chat webhook URL.");
  if (channel === "telegram" && (!config.telegramBotToken || !config.telegramChatId)) {
    return toast("Hãy nhập Telegram bot token và chat id.");
  }
  toast("Đang gửi tin thử...");
  try {
    await apiPost("/api/test-webhook", config);
    toast("Đã gửi! Kiểm tra kênh nhận tin xem có tin thử chưa.");
  } catch (e) {
    toast("Test lỗi: " + e.message);
  }
}

// Lưu cấu hình gửi về server khi người dùng đổi (để lần sau tự điền).
async function saveChannelConfig() {
  if (!token) return;
  try {
    await apiPost("/api/account", channelPayload());
  } catch {
    /* im lặng: sẽ lưu lại khi đặt lịch */
  }
}

function channelPayload() {
  return {
    channel,
    webhookUrl: $("webhook").value.trim(),
    telegramBotToken: $("telegramBotToken").value.trim(),
    telegramChatId: $("telegramChatId").value.trim(),
  };
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
  detailItems = [];
  renderParsed();
  renderDetails();
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
$("webhook").onchange = saveChannelConfig;
$("telegramBotToken").onchange = saveChannelConfig;
$("telegramChatId").onchange = saveChannelConfig;
$("json").onchange = () => saveJson($("json").value);
$("clearJsonBtn").onclick = clearJson;
$("testWebhookBtn").onclick = testWebhook;
for (const input of document.querySelectorAll('input[name="channel"]')) {
  input.onchange = () => {
    setChannel(input.value);
    saveChannelConfig();
  };
}
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
