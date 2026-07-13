// Giao diện: đăng nhập (tên + PIN) → parse JSON (client) → hẹn giờ qua server → xem/huỷ lịch.
// Token phiên lưu localStorage; mọi call /api có kèm Bearer token.

const $ = (id) => document.getElementById(id);
const LS_TOKEN = "coc_token";
const API_BASE = String(window.COC_API_BASE || "").replace(/\/$/, "");

let token = localStorage.getItem(LS_TOKEN) || "";
let account = "";
let parsed = []; // việc parse ở client, chưa gửi server
let serverTasks = []; // việc đã lên lịch trên server (giữ ở client để hiện ngay)
let catalog = null;
let channel = "google";
let speed10x = false;
let clockBaseSec = 0;
let clockBaseMs = Date.now();
let lastDisplayNow = -1;
let activeTab = "parse";
let potionPreview = false;
let potionPreviewStartedAt = 0;

const TASK_TABS = [
  { category: "Thợ xây", body: "body-builders", count: "count-builders" },
  { category: "Lab", body: "body-lab", count: "count-lab" },
  { category: "Builder Base", body: "body-builder-base", count: "count-builder-base" },
  { category: "Thợ phụ", body: "body-helper", count: "count-helper" },
  { category: "Tháp đồng hồ", body: "body-clock", count: "count-clock" },
];

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
  String(s).replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
  );
const escAttr = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

function authHeaders(extra) {
  const h = extra || {};
  if (token) h.Authorization = "Bearer " + token;
  return h;
}

async function apiGet(path) {
  const r = await fetch(apiUrl(path), { headers: authHeaders() });
  return handle(r);
}

async function apiPost(path, body) {
  const r = await fetch(apiUrl(path), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  return handle(r);
}

function apiUrl(path) {
  return API_BASE ? `${API_BASE}${path}` : path;
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
  if ($("json").value.trim()) {
    parseCurrentJson({ save: false, switchTab: false, quiet: true });
  }
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

function setActiveTab(tab) {
  activeTab = tab;
  for (const button of document.querySelectorAll(".tab")) {
    button.classList.toggle("active", button.dataset.tab === tab);
  }
  for (const panel of document.querySelectorAll(".tab-panel")) {
    panel.classList.toggle("active", panel.id === `tab-${tab}`);
  }
  $("serverSchedule").hidden = tab !== "parse";
  $("scheduleBtn").hidden = tab !== "parse";
}

// ---- Bảng ----
async function loadCatalog() {
  if (catalog) return catalog;
  try {
    catalog = await fetch("data/catalog.json?v=5").then((r) => r.json());
  } catch {
    catalog = { items: {} };
  }
  return catalog;
}

function renderTable(tbodyId, rows, onDelete, previewPotions = false) {
  const now = displayNowSec();
  const tbody = $(tbodyId);
  tbody.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    const boosted = previewPotions ? potionResult(row, now) : null;
    const remainingHtml = boosted
      ? `${remaining(row.finishAt, now)}<br><strong class="preview-value">${remaining(now + boosted.remainingSec, now)}</strong><br><span class="preview-saving">Giảm ${formatSeconds(boosted.savedSec)}</span>`
      : remaining(row.finishAt, now);
    const finishHtml = boosted
      ? `${finishClock(row.finishAt)}<br><strong class="preview-value">${finishClock(now + boosted.remainingSec)}</strong>`
      : finishClock(row.finishAt);
    tr.innerHTML = `<td>${esc(row.label)}</td><td>${remainingHtml}</td><td>${finishHtml}</td>`;
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
  const remove = (row) => {
    parsed = parsed.filter((x) => x.id !== row.id);
    renderParsed();
  };
  for (const tab of TASK_TABS) {
    const rows = parsed.filter((task) => task.category === tab.category);
    renderTable(tab.body, rows, remove, potionPreview);
    $(tab.count).textContent = rows.length;
  }
  $("parsedCount").textContent = parsed.length;
  $("taskActions").hidden = parsed.length === 0;
}

function potionCount(id) {
  const value = Math.floor(Number($(id).value || 0));
  return Math.max(0, Math.min(99, value));
}

function potionResult(task, now) {
  let multiplier = 1;
  let count = 0;
  if (task.category === "Thợ xây") {
    multiplier = 10;
    count = potionCount("builderPotionCount");
  } else if (task.category === "Lab") {
    multiplier = 24;
    count = potionCount("researchPotionCount");
  }
  if (!potionPreview || count === 0 || multiplier === 1) return null;

  const previewStart = potionPreviewStartedAt || now;
  const normalSec = Math.max(0, Math.floor(task.finishAt - previewStart));
  const boostedWorkSec = count * 3600 * multiplier;
  const boostedDurationSec = normalSec <= boostedWorkSec
    ? Math.ceil(normalSec / multiplier)
    : normalSec - count * 3600 * (multiplier - 1);
  const previewFinishAt = previewStart + boostedDurationSec;
  return {
    remainingSec: Math.max(0, previewFinishAt - now),
    savedSec: task.finishAt - previewFinishAt,
  };
}

function formatSeconds(totalSec) {
  const seconds = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const p = (n) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(s)}`;
}

function togglePotionPreview() {
  potionPreview = !potionPreview;
  potionPreviewStartedAt = potionPreview ? displayNowSec() : 0;
  const button = $("potionPreviewBtn");
  button.textContent = potionPreview ? "Tắt Preview" : "Bật Preview";
  button.setAttribute("aria-pressed", String(potionPreview));
  button.classList.toggle("active", potionPreview);
  renderParsed();
}

function refreshPotionPreview() {
  if (potionPreview) potionPreviewStartedAt = displayNowSec();
  renderParsed();
}

function parseCurrentJson(options = {}) {
  const shouldSave = options.save !== false;
  const shouldSwitchTab = options.switchTab !== false;
  const quiet = options.quiet === true;
  const jsonText = $("json").value;
  if (shouldSave) saveJson(jsonText);
  try {
    parsed = parseVillage(jsonText, nowSec(), catalog);
    renderParsed();
    if (parsed.length > 0 && shouldSwitchTab) setActiveTab("work-builders");
    if (parsed.length === 0 && !quiet) toast("Không có việc nào đang chạy.");
  } catch (e) {
    parsed = [];
    renderParsed();
    if (!quiet) toast("Dữ liệu không hợp lệ: " + e.message);
  }
}

function doParse() {
  parseCurrentJson({ save: true, switchTab: true });
}

function renderDetails() {
  const homeItems = detailItems.filter((item) => item.village === "home");
  const builderItems = detailItems.filter((item) => item.village === "builder");
  renderDetailTable("homeDetailBody", homeItems);
  renderDetailTable("builderDetailBody", builderItems);

  const homeSummary = summarizeItems(homeItems);
  const builderSummary = summarizeItems(builderItems);
  renderSummary(homeSummary);

  $("homeDetailCount").textContent = homeItems.length;
  $("builderDetailCount").textContent = builderItems.length;
  $("homeSummary").textContent = summaryLabel(homeSummary);
  $("builderSummary").textContent = summaryLabel(builderSummary);
  $("homeDetailCard").hidden = homeItems.length === 0;
  $("builderDetailCard").hidden = builderItems.length === 0;
  $("summaryCard").hidden = detailItems.length === 0;
}

function renderDetailTable(tbodyId, rows) {
  const tbody = $(tbodyId);
  tbody.innerHTML = "";
  for (const item of rows) {
    const tr = document.createElement("tr");
    const levelText = item.maxLevel
      ? `${item.currentLevel}/${item.maxLevel}`
      : `${item.currentLevel}/?`;
    const countText =
      item.count > 1 ? ` <span class="muted">x${item.count}</span>` : "";
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
}

function viResource(resource) {
  const names = {
    Gold: "Vàng",
    Elixir: "Tiên dược",
    "Dark Elixir": "Tiên dược Hắc ám",
    "Builder Gold": "Vàng Thợ xây",
    "Builder Elixir": "Tiên dược Thợ xây",
    Gems: "Đá quý",
    "Capital Gold": "Vàng Thủ đô",
    "Shiny Ore": "Quặng Sáng",
    "Glowing Ore": "Quặng Lấp lánh",
    "Starry Ore": "Quặng Sao",
    "Sparky Stones": "Đá Tia lửa",
    Unknown: "Không rõ",
  };
  return names[resource] || resource;
}

function itemNameHtml(item) {
  const image = item.imageUrl
    ? `<img class="item-icon" src="${escAttr(item.imageUrl)}" alt="" loading="lazy" onerror="this.remove()" />`
    : "";
  return `<span class="item-name">${image}<span>${esc(item.displayName || item.name)}</span></span>`;
}

function summarizeItems(items) {
  const summary = {
    itemCount: items.length,
    currentCount: 0,
    remainingLevels: 0,
    totalTimeSec: 0,
    parallelTimeSec: 0,
    durations: [],
    costs: {},
  };
  for (const item of items) {
    summary.currentCount += Number(item.count || 0);
    summary.remainingLevels +=
      Number(item.remainingLevels || 0) * Number(item.count || 1);
    summary.totalTimeSec += Number(item.totalTimeSec || 0);
    summary.durations.push(...(item.remainingDurations || []));
    for (const [resource, value] of Object.entries(item.costs || {})) {
      summary.costs[resource] =
        (summary.costs[resource] || 0) + Number(value || 0);
    }
  }
  summary.parallelTimeSec = parallelDuration(summary.durations, 5);
  return summary;
}

function renderSummary(summary) {
  $("sumItems").textContent = Number(summary.itemCount).toLocaleString();
  $("sumCount").textContent = Number(summary.currentCount).toLocaleString();
  $("sumLevels").textContent = Number(summary.remainingLevels).toLocaleString();
  $("sumTime").textContent = formatDuration(summary.totalTimeSec);
  $("sumParallelTime").textContent = formatDuration(summary.parallelTimeSec);

  const tbody = $("resourceSummaryBody");
  tbody.innerHTML = "";
  const entries = Object.entries(summary.costs).filter(
    ([, value]) => value > 0,
  );
  entries.sort((a, b) => b[1] - a[1]);
  for (const [resource, value] of entries) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${esc(viResource(resource))}</td><td>${Number(value).toLocaleString()}</td>`;
    tbody.appendChild(tr);
  }
}

function summaryLabel(summary) {
  return `${Number(summary.currentCount).toLocaleString()} hiện có · ${formatDuration(summary.parallelTimeSec)} với 5 thợ`;
}

function renderServer() {
  serverTasks.sort((a, b) => a.finishAt - b.finishAt);
  const unmatched = [...parsed];
  const displayTasks = serverTasks.map((row) => {
    const matchIndex = unmatched.findIndex(
      (task) => Number(task.finishAt) === Number(row.finishAt),
    );
    if (matchIndex < 0) return row;
    const [current] = unmatched.splice(matchIndex, 1);
    return { ...row, label: current.label };
  });
  renderTable("serverBody", displayTasks, async (row) => {
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
  if (channel === "google" && !config.webhookUrl)
    return toast("Hãy nhập Google Chat webhook URL.");
  if (
    channel === "telegram" &&
    (!config.telegramBotToken || !config.telegramChatId)
  ) {
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
    toast(
      `Đã thay ${res.replaced || 0} lịch cũ và đặt ${res.scheduled} lịch mới.`,
    );
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
  if (channel === "google" && !config.webhookUrl)
    return toast("Hãy nhập Google Chat webhook URL.");
  if (
    channel === "telegram" &&
    (!config.telegramBotToken || !config.telegramChatId)
  ) {
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
$("webhook").onchange = saveChannelConfig;
$("telegramBotToken").onchange = saveChannelConfig;
$("telegramChatId").onchange = saveChannelConfig;
$("json").onchange = () => saveJson($("json").value);
$("clearJsonBtn").onclick = clearJson;
$("testWebhookBtn").onclick = testWebhook;
$("potionPreviewBtn").onclick = togglePotionPreview;
$("builderPotionCount").oninput = refreshPotionPreview;
$("researchPotionCount").oninput = refreshPotionPreview;
for (const input of document.querySelectorAll('input[name="channel"]')) {
  input.onchange = () => {
    setChannel(input.value);
    saveChannelConfig();
  };
}
for (const button of document.querySelectorAll(".tab")) {
  button.onclick = () => setActiveTab(button.dataset.tab || "parse");
}
$("speed10x").onchange = () => {
  speed10x = $("speed10x").checked;
  resetClock();
  renderCountdowns();
};
resetClock();
setActiveTab(activeTab);
setInterval(renderCountdowns, 100);

// Tự vào app nếu còn token hợp lệ.
if (token) {
  enterApp().catch(() => logout());
}
