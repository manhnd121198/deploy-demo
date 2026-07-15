// Giao diện: đăng nhập (tên + PIN) → parse JSON (client) → hẹn giờ qua server → xem/huỷ lịch.
// Token phiên lưu localStorage; mọi call /api có kèm Bearer token.

const $ = (id) => document.getElementById(id);
const LS_TOKEN = "coc_token";
const LS_PLANNER_BUILDING = "coc_planner_building";
const LS_OPTIMIZER_BUILDERS = "coc_optimizer_builders";
const LS_PLANNER_TYPE = "coc_planner_type";
const LS_PLANNER_RESOURCE = "coc_planner_resource";
const LS_SIDEBAR_COLLAPSED = "coc_sidebar_collapsed";
const API_BASE = String(window.COC_API_BASE || "").replace(/\/$/, "");

let token = localStorage.getItem(LS_TOKEN) || "";
let account = "";
let parsed = []; // việc parse ở client, chưa gửi server
let plannerItems = [];
let catalog = null;
let channel = "google";
let clockBaseSec = 0;
let clockBaseMs = Date.now();
let lastDisplayNow = -1;
let activeTab = "parse";
let potionPreview = false;
let potionPreviewStartedAt = 0;
let summerJamEnabled = false;
let plannerBuildingId = localStorage.getItem(LS_PLANNER_BUILDING) || "";
let jsonPreviewTimer = 0;

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
  return Math.floor(clockBaseSec + elapsedSec);
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
  setMobileMenuOpen(false);
  token = "";
  account = "";
  localStorage.removeItem(LS_TOKEN);
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
  $("mobileWho").textContent = account;
  setChannel(acct.channel || "google");
  $("webhook").value = acct.webhookUrl || "";
  $("telegramBotToken").value = acct.telegramBotToken || "";
  $("telegramChatId").value = acct.telegramChatId || "";
  $("json").value = acct.json || "";
  await loadCatalog();
  if ($("json").value.trim()) {
    parseCurrentJson({ switchTab: false, quiet: true });
  } else {
    renderUpgradePlannerOptions();
    renderSummerOptimizer();
  }
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

function setSidebarCollapsed(collapsed) {
  $("sidebarToggle").closest(".sidebar").classList.toggle("collapsed", collapsed);
  $("sidebarToggle").closest(".app-shell").classList.toggle("sidebar-collapsed", collapsed);
  $("sidebarToggle").setAttribute("aria-expanded", String(!collapsed));
  $("sidebarToggle").setAttribute("aria-label", collapsed ? "Mở rộng menu" : "Thu gọn menu");
  localStorage.setItem(LS_SIDEBAR_COLLAPSED, String(collapsed));
}

function setMobileMenuOpen(open) {
  $("appSidebar").classList.toggle("mobile-open", open);
  $("sidebarOverlay").hidden = !open;
  $("mobileMenuBtn").setAttribute("aria-expanded", String(open));
  $("mobileMenuBtn").setAttribute("aria-label", open ? "Đóng menu" : "Mở menu");
  document.body.classList.toggle("mobile-menu-open", open);
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
  renderTable("serverBody", parsed, remove, potionPreview);
  $("serverCount").textContent = parsed.length;
  renderTable("body-all", parsed, remove, potionPreview);
  $("count-all").textContent = parsed.length;
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
  const boostedDurationSec = applyPotionDuration(normalSec, multiplier, count);
  const previewFinishAt = previewStart + boostedDurationSec;
  return {
    remainingSec: Math.max(0, previewFinishAt - now),
    savedSec: task.finishAt - previewFinishAt,
  };
}

function applyPotionDuration(normalSec, multiplier, count) {
  const boostedWorkSec = count * 3600 * multiplier;
  return normalSec <= boostedWorkSec
    ? Math.ceil(normalSec / multiplier)
    : normalSec - count * 3600 * (multiplier - 1);
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

async function usePotion(category, arrayKeys, multiplier, countId, potionName) {
  const count = potionCount(countId);
  if (count === 0) return toast("Số lượng thuốc phải lớn hơn 0.");
  if (!parsed.some((task) => task.category === category)) {
    return toast(`Không có việc ${category} đang chạy.`);
  }
  if (!confirm(`Xác nhận đã dùng ${count} ${potionName} trong Clash of Clans?`)) return;

  const oldJson = $("json").value;
  const oldParsed = parsed;
  try {
    const root = JSON.parse(oldJson);
    const timestamp = Number(root.timestamp || 0);
    const now = nowSec();
    for (const key of arrayKeys) {
      const rows = Array.isArray(root[key]) ? root[key] : [];
      for (const row of rows) {
        const timer = Number(row?.timer || 0);
        if (timer <= 0) continue;
        const normalSec = Math.max(0, timestamp + timer - now);
        const boostedSec = applyPotionDuration(normalSec, multiplier, count);
        row.timer = Math.max(1, now + boostedSec - timestamp);
      }
    }

    const updatedJson = JSON.stringify(root);
    $("json").value = updatedJson;
    parsed = parseVillage(updatedJson, now, catalog);
    potionPreview = false;
    potionPreviewStartedAt = 0;
    $("potionPreviewBtn").textContent = "Bật Preview";
    $("potionPreviewBtn").setAttribute("aria-pressed", "false");
    $("potionPreviewBtn").classList.remove("active");
    renderParsed();

    const scheduled = await scheduleAll(`Đã dùng ${count} ${potionName} và cập nhật lịch.`);
    if (!scheduled) throw new Error("Không cập nhật được lịch server");
    await saveJson(updatedJson);
  } catch (e) {
    $("json").value = oldJson;
    parsed = oldParsed;
    renderParsed();
    toast(`Không sử dụng được thuốc: ${e.message}`);
  }
}

function parseCurrentJson(options = {}) {
  const shouldSwitchTab = options.switchTab !== false;
  const quiet = options.quiet === true;
  const jsonText = $("json").value;
  try {
    parsed = parseVillage(jsonText, nowSec(), catalog);
    plannerItems = parseVillageItems(jsonText, catalog);
    renderParsed();
    renderUpgradePlannerOptions();
    renderSummerOptimizer();
    if (parsed.length > 0 && shouldSwitchTab) setActiveTab("work-builders");
    if (parsed.length === 0 && !quiet) toast("Không có việc nào đang chạy.");
  } catch (e) {
    parsed = [];
    plannerItems = [];
    renderParsed();
    renderUpgradePlannerOptions();
    renderSummerOptimizer();
    if (!quiet) toast("Dữ liệu không hợp lệ: " + e.message);
  }
}

function doParse() {
  parseCurrentJson({ switchTab: false });
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

function summerJamPhases() {
  return [
    ["2026-07-01T08:00:00Z", "2026-07-08T08:00:00Z", "Gold", "Vàng"],
    ["2026-07-08T08:00:00Z", "2026-07-15T08:00:00Z", "Elixir", "Tiên dược"],
    ["2026-07-15T08:00:00Z", "2026-07-22T08:00:00Z", "Dark Elixir", "Tiên dược Hắc ám"],
    ["2026-07-22T08:00:00Z", "2026-08-01T08:00:00Z", "all", "mọi tài nguyên"],
  ].map(([start, end, resource, label]) => ({
    start: Math.floor(Date.parse(start) / 1000),
    end: Math.floor(Date.parse(end) / 1000),
    resource,
    label,
  }));
}

function summerJamPhase(date = new Date()) {
  const time = Math.floor(date.getTime() / 1000);
  return summerJamPhases().find((phase) => time >= phase.start && time < phase.end) || null;
}

function buildSummerOptimizerPlan(builderCount, goldPassPercent, phasePriorities = {}) {
  const ignoredCollectors = new Set(["1000002", "1000004", "1000023"]);
  const troopBuildings = new Set(["Laboratory", "Army Camp", "Barracks", "Dark Barracks", "Workshop", "Clan Castle"]);
  const heroBuildings = new Set(["Hero Hall", "Blacksmith"]);
  const now = nowSec();
  const phases = summerJamPhases().filter((phase) => phase.end > now);
  if (phases.length === 0) return { phases: [], eligible: 0, rows: [], saved: 0 };
  const townHall = Number(plannerItems[0]?.townHallLevel || 0);
  const summerPercent = townHall > 0 && townHall <= 16 ? 40 : 25;
  const factor = (1 - summerPercent / 100) * (1 - goldPassPercent / 100);
  const activeBuilders = plannerItems
    .filter((item) => ["Công trình làng chính", "Anh hùng"].includes(item.source) && item.finishAt > now)
    .map((item) => item.finishAt)
    .sort((a, b) => a - b);
  const activeLab = plannerItems
    .filter((item) => ["Quân lính", "Máy công thành", "Thần chú"].includes(item.source) && item.finishAt > now)
    .map((item) => item.finishAt)
    .sort((a, b) => a - b);
  const workerTotal = Math.max(builderCount, activeBuilders.length);
  const builderWorkers = Array.from({ length: workerTotal }, (_, index) => ({ label: `Thợ ${index + 1}`, at: activeBuilders[index] || now }));
  const labWorkers = [
    { label: "Lab", at: activeLab[0] || now },
    { label: "Yêu tinh", at: activeLab[1] || now },
  ];
  const chains = [];
  for (const item of plannerItems) {
    const builderQueue = ["Công trình làng chính", "Anh hùng"].includes(item.source);
    const labQueue = ["Quân lính", "Máy công thành", "Thần chú"].includes(item.source);
    if ((!builderQueue && !labQueue) || !item.matched) continue;
    if (ignoredCollectors.has(item.dataId)) continue;
    const catalogItem = catalog?.items?.[item.dataId] || {};
    for (let index = 0; index < Number(item.count || 1); index += 1) {
      const levels = (item.upgradeLevels || []).slice(item.timer > 0 && index === 0 ? 1 : 0);
      if (levels.length === 0) continue;
      chains.push({
        name: `${item.displayName || item.name}${Number(item.count || 1) > 1 ? ` #${index + 1}` : ""}`,
        queue: builderQueue ? "builder" : "lab",
        source: item.source,
        kind: catalogItem.kind || "",
        troopBuilding: troopBuildings.has(item.name),
        heroBuilding: heroBuildings.has(item.name),
        levels,
        next: 0,
        at: item.timer > 0 && index === 0 ? item.finishAt : now,
      });
    }
  }
  const eligibleResources = new Set(phases.flatMap((phase) => phase.resource === "all" ? ["Gold", "Elixir", "Dark Elixir"] : [phase.resource]));
  const eligible = chains.reduce((sum, chain) =>
    sum + chain.levels.filter((level) => eligibleResources.has(level.resource)).length, 0);
  function priorityWeight(chain, phase) {
    const priority = phasePriorities[phase.label] || "normal";
    if (priority === "defense" && chain.kind === "defense") return 3;
    if (priority === "troop") {
      if (["Quân lính", "Máy công thành"].includes(chain.source)) return 3;
      if (chain.troopBuilding) return 2;
    }
    if (priority === "hero") {
      if (chain.source === "Anh hùng") return 3;
      if (chain.heroBuilding) return 2;
    }
    return 1;
  }
  function scheduleQueue(queue, workers) {
    const queueChains = chains.filter((chain) => chain.queue === queue);
    const rows = [];
    let saved = 0;
    while (true) {
    workers.sort((a, b) => a.at - b.at || a.label.localeCompare(b.label));
    const worker = workers[0];
    if (!worker || worker.at >= phases[phases.length - 1].end) break;
    const unfinished = queueChains.filter((chain) => chain.next < chain.levels.length);
    if (unfinished.length === 0) break;
    const candidates = unfinished.map((chain) => {
      const level = chain.levels[chain.next];
      const availableAt = Math.max(now, worker.at, chain.at);
      const phase = phases.find((entry) => {
        const startAt = Math.max(availableAt, entry.start);
        const resourceMatches = entry.resource === "all"
          ? eligibleResources.has(level.resource)
          : entry.resource === level.resource;
        return startAt < entry.end && resourceMatches;
      });
        return phase ? { chain, level, phase, startAt: Math.max(availableAt, phase.start), weight: priorityWeight(chain, phase) } : null;
    }).filter(Boolean);
    if (candidates.length === 0) break;
      const bestWeight = Math.max(...candidates.map((candidate) => candidate.weight));
      const weighted = candidates.filter((candidate) => candidate.weight === bestWeight);
    weighted.sort((a, b) => a.startAt - b.startAt || Number(a.level.timeSec || 0) - Number(b.level.timeSec || 0));
    const earliestStart = weighted[0].startAt;
    const earliest = weighted.filter((candidate) => candidate.startAt === earliestStart);
    const remainingWindow = earliest[0].phase.end - earliestStart;
    const finalCandidates = earliest.filter((candidate) =>
      Math.ceil(Number(candidate.level.timeSec || 0) * factor) >= remainingWindow,
    );
    const pool = finalCandidates.length ? finalCandidates : earliest;
    pool.sort((a, b) => {
      const difference = Number(a.level.timeSec || 0) - Number(b.level.timeSec || 0);
      return finalCandidates.length ? -difference : difference;
    });
    const { chain, level, phase, startAt } = pool[0];
    const baseTime = Number(level.timeSec || 0);
    const duration = Math.ceil(baseTime * factor);
    const finishAt = startAt + duration;
    const saving = baseTime - duration;
    rows.push({ worker: worker.label, queue, startAt, finishAt, duration, saving, phase: phase.label, name: chain.name, from: Number(level.level) - 1, to: Number(level.level) });
    saved += saving;
    worker.at = finishAt;
    chain.at = finishAt;
    chain.next += 1;
  }
    return { rows, saved };
  }
  const builderSchedule = scheduleQueue("builder", builderWorkers);
  const labSchedule = scheduleQueue("lab", labWorkers);
  const rows = [...builderSchedule.rows, ...labSchedule.rows];
  const saved = builderSchedule.saved + labSchedule.saved;
  rows.sort((a, b) => a.startAt - b.startAt || a.worker.localeCompare(b.worker));
  return { phases, eligible, rows, saved, summerPercent };
}

function renderSummerOptimizer() {
  const builders = Math.max(1, Math.min(7, Number($("optimizerBuilderCount").value || 5)));
  const phasePriorities = Object.fromEntries(summerJamPhases().map((phase) => [
    phase.label,
    localStorage.getItem(`coc_optimizer_priority_${phase.resource}`) || "normal",
  ]));
  const plan = buildSummerOptimizerPlan(builders, Number($("optimizerGoldPass").value || 0), phasePriorities);
  const phaseCards = $("optimizerPhaseCards");
  phaseCards.innerHTML = "";
  $("optimizerEligible").textContent = plan.eligible.toLocaleString();
  $("optimizerScheduled").textContent = plan.rows.length.toLocaleString();
  $("optimizerSaved").textContent = formatDuration(plan.saved);
  const currentPhase = summerJamPhase();
  const finalPhase = plan.phases[plan.phases.length - 1];
  $("optimizerPhase").textContent = currentPhase ? `Hiện tại: ${currentPhase.label}` : "Chờ phase tiếp theo";
  $("optimizerDeadline").textContent = finalPhase ? finishClock(finalPhase.end) : "-";
  $("optimizerInfo").textContent = plan.phases.length
    ? `Không giới hạn tài nguyên; mỗi phase có ưu tiên riêng. Nghiên cứu có 2 slot trong tháng 7: Laboratory và Yêu tinh 1 Ngọc. Áp dụng mức giảm Summer Jam ${plan.summerPercent}% tại lúc bắt đầu nâng.`
    : "Hiện không có phase Summer Jam đang hoạt động.";
  for (const phase of plan.phases) {
    const phaseRows = plan.rows.filter((row) => row.phase === phase.label);
    const card = document.createElement("div");
    card.className = "optimizer-phase-card";
    const body = phaseRows.length
      ? phaseRows.map((row) => `<tr><td>${esc(row.worker)}</td><td>${finishClock(row.startAt)}</td><td>${esc(row.name)}</td><td>${row.from} → ${row.to}</td><td>${formatDuration(row.duration)}</td><td>${finishClock(row.finishAt)}</td><td>${formatDuration(row.saving)}</td></tr>`).join("")
      : '<tr><td colspan="7" class="muted">Không có nâng cấp được xếp trong phase này.</td></tr>';
    card.innerHTML = `
      <div class="row">
        <h3>Phase ${esc(phase.label)}</h3>
        <label>Ưu tiên
          <select class="phase-priority" data-resource="${escAttr(phase.resource)}">
            <option value="normal">Bình thường</option>
            <option value="defense">Công trình phòng thủ</option>
            <option value="troop">Lính</option>
            <option value="hero">Tướng</option>
          </select>
        </label>
        <span class="pill">${phaseRows.length} nâng cấp</span>
      </div>
      <p class="sub planner-note">${finishClock(phase.start)} → ${finishClock(phase.end)}</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Hàng đợi</th><th>Bắt đầu</th><th>Hạng mục</th><th>Nâng cấp</th><th>Thời gian sau giảm</th><th>Xong lúc</th><th>Tiết kiệm</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
    const prioritySelect = card.querySelector(".phase-priority");
    prioritySelect.value = phasePriorities[phase.label] || "normal";
    prioritySelect.onchange = () => {
      localStorage.setItem(`coc_optimizer_priority_${phase.resource}`, prioritySelect.value);
      renderSummerOptimizer();
    };
    phaseCards.appendChild(card);
  }
  $("optimizerEmpty").hidden = plan.rows.length > 0;
  $("optimizerEmpty").textContent = plan.phases.length && plan.eligible > 0
    ? "Không có thợ nào kịp bắt đầu nâng trước khi Summer Jam kết thúc."
    : "Không có nâng cấp phù hợp với các phase còn lại.";
}

function plannerGroups() {
  const type = $("plannerTypeSelect").value;
  const resource = $("plannerResourceSelect").value;
  const sources = {
    building: ["Công trình làng chính"],
    hero: ["Anh hùng"],
    troop: ["Quân lính", "Máy công thành"],
    spell: ["Thần chú"],
  }[type] || [];
  const groups = new Map();
  for (const item of plannerItems) {
    if (!sources.includes(item.source) || !item.matched) continue;
    if (type === "building") {
      const levels = catalog?.items?.[item.dataId]?.levels || [];
      const nextLevel = item.upgradeLevels[0] || levels.find((level) => Number(level.level) > item.currentLevel) || levels.at(-1);
      if (nextLevel?.resource !== resource) continue;
    }
    const group = groups.get(item.dataId) || [];
    group.push(item);
    groups.set(item.dataId, group);
  }
  return groups;
}

function renderUpgradePlannerOptions(queryText = null) {
  const options = $("buildingOptions");
  const query = String(queryText || "").trim().toLocaleLowerCase("vi");
  const groups = plannerGroups();
  options.innerHTML = "";

  const entries = [...groups.entries()]
    .filter(([, items]) => (items[0].displayName || items[0].name).toLocaleLowerCase("vi").includes(query))
    .sort((a, b) => (a[1][0].displayName || a[1][0].name).localeCompare(b[1][0].displayName || b[1][0].name, "vi"));
  for (const [dataId, items] of entries) {
    const option = document.createElement("button");
    const count = items.reduce((sum, item) => sum + Number(item.count || 1), 0);
    option.type = "button";
    option.className = `planner-option${dataId === plannerBuildingId ? " selected" : ""}`;
    option.setAttribute("role", "option");
    const category = plannerCategoryLabel(items[0]);
    option.textContent = `${items[0].displayName || items[0].name} (${category}, ${count})`;
    option.onclick = () => {
      plannerBuildingId = dataId;
      localStorage.setItem(LS_PLANNER_BUILDING, plannerBuildingId);
      $("buildingSearch").value = option.textContent;
      closeBuildingOptions();
      renderUpgradePlanner();
    };
    options.appendChild(option);
  }
  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "planner-no-option";
    empty.textContent = plannerItems.length ? "Không tìm thấy công trình" : "Chưa có dữ liệu JSON";
    options.appendChild(empty);
  } else if (queryText === null) {
    if (!groups.has(plannerBuildingId)) {
      plannerBuildingId = entries[0][0];
      localStorage.setItem(LS_PLANNER_BUILDING, plannerBuildingId);
    }
    const selectedItems = groups.get(plannerBuildingId);
    const count = selectedItems.reduce((sum, item) => sum + Number(item.count || 1), 0);
    const category = plannerCategoryLabel(selectedItems[0]);
    $("buildingSearch").value = `${selectedItems[0].displayName || selectedItems[0].name} (${category}, ${count})`;
  }
  renderUpgradePlanner();
}

function plannerCategoryLabel(item) {
  if (item.source === "Anh hùng") return "Tướng";
  if (["Quân lính", "Máy công thành"].includes(item.source)) return "Lính";
  if (item.source === "Thần chú") return "Thần chú";
  return "Công trình";
}

function openBuildingOptions() {
  renderUpgradePlannerOptions("");
  $("buildingOptions").hidden = false;
  $("buildingSearch").setAttribute("aria-expanded", "true");
}

function closeBuildingOptions() {
  $("buildingOptions").hidden = true;
  $("buildingSearch").setAttribute("aria-expanded", "false");
}

function calculateUpgradePlan(items, goldPassPercent, summerJam) {
  const result = { count: 0, levels: 0, baseTime: 0, discountedTime: 0, resources: {}, details: [] };
  const goldFactor = 1 - goldPassPercent / 100;
  const activeLabFinishTimes = plannerItems
    .filter((item) => ["Quân lính", "Máy công thành", "Thần chú"].includes(item.source))
    .map((item) => Number(item.finishAt || 0))
    .filter((finishAt) => finishAt > nowSec())
    .sort((a, b) => a - b);
  const labAvailableAt = activeLabFinishTimes.length < 2 ? nowSec() : activeLabFinishTimes[0];
  for (const item of items) {
    const itemCount = Number(item.count || 1);
    result.count += itemCount;
    const isLabItem = ["Quân lính", "Máy công thành", "Thần chú"].includes(item.source);
    const startsAt = isLabItem && item.timer <= 0 ? labAvailableAt : nowSec();
    const finishTimes = Array.from({ length: itemCount }, () => startsAt);
    for (const [levelIndex, level] of (item.upgradeLevels || []).entries()) {
      const count = Number(level.count || 1);
      const runningCount = levelIndex === 0 && item.timer > 0 ? 1 : 0;
      const runningTime = runningCount ? Math.max(0, Number(item.finishAt || 0) - nowSec()) : 0;
      const summerApplies = summerJam?.enabled &&
        (summerJam.resource === "all" || level.resource === summerJam.resource);
      const summerFactor = summerApplies ? 1 - summerJam.percent / 100 : 1;
      const factor = summerFactor * goldFactor;
      const baseTime = Number(level.timeSec || 0);
      result.levels += count;
      const discountedTime = Math.ceil(baseTime * factor);
      result.baseTime += runningTime + baseTime * (count - runningCount);
      result.discountedTime += runningTime + discountedTime * (count - runningCount);
      for (let index = 0; index < count; index += 1) {
        const running = index < runningCount;
        const rowBaseTime = running ? runningTime : baseTime;
        const rowDiscountedTime = running ? runningTime : discountedTime;
        finishTimes[index] += rowDiscountedTime;
        result.details.push({
          building: `${item.displayName || item.name}${itemCount > 1 ? ` #${index + 1}` : ""}`,
          fromLevel: Number(level.level || 0) - 1,
          toLevel: Number(level.level || 0),
          baseTime: rowBaseTime,
          discountedTime: rowDiscountedTime,
          finishAt: finishTimes[index],
          running,
        });
      }

      const costs = level.costs && typeof level.costs === "object"
        ? level.costs
        : { [level.resource || "Unknown"]: Number(level.cost || 0) };
      for (const [resource, value] of Object.entries(costs)) {
        const payableCount = count - runningCount;
        const base = Number(value || 0) * payableCount;
        const current = result.resources[resource] || { base: 0, discounted: 0 };
        current.base += base;
        current.discounted += Math.ceil(Number(value || 0) * factor) * payableCount;
        result.resources[resource] = current;
      }
    }
  }
  return result;
}

function renderUpgradePlanner() {
  const groups = plannerGroups();
  const items = groups.get(plannerBuildingId) || [];
  const townHall = Number(plannerItems[0]?.townHallLevel || 0);
  const phase = summerJamPhase();
  const summerPercent = townHall > 0 && townHall <= 16 ? 40 : 25;
  $("plannerTownHall").textContent = townHall ? `Nhà Chính ${townHall}` : "Nhà Chính ?";
  $("summerJamInfo").textContent = phase
    ? `Summer Jam 2026 hiện áp dụng cho nâng cấp bằng ${phase.label}: giảm ${summerPercent}% chi phí và thời gian ở Nhà Chính ${townHall || "?"}.`
    : "Summer Jam 2026 hiện không trong thời gian hiệu lực.";
  $("plannerResult").hidden = items.length === 0;
  $("plannerEmpty").hidden = items.length > 0;
  if (items.length === 0) return;

  const plan = calculateUpgradePlan(items, Number($("goldPassSelect").value || 0), {
    enabled: summerJamEnabled && Boolean(phase),
    resource: phase?.resource,
    percent: summerPercent,
  });
  $("plannerCount").textContent = plan.count.toLocaleString();
  const currentLevels = [...new Set(items.map((item) => Number(item.currentLevel || 0)))].sort((a, b) => a - b);
  const maxLevel = Math.max(0, ...items.map((item) => Number(item.maxLevel || 0)));
  $("plannerCurrentLevel").textContent = currentLevels.join(", ");
  $("plannerMaxLevel").textContent = maxLevel.toLocaleString();
  $("plannerLevels").textContent = plan.levels.toLocaleString();
  $("plannerBaseTime").textContent = formatDuration(plan.baseTime);
  $("plannerDiscountTime").textContent = formatDuration(plan.discountedTime);

  const tbody = $("plannerResourceBody");
  tbody.innerHTML = "";
  const resources = Object.entries(plan.resources)
    .filter(([, amounts]) => amounts.base > 0)
    .sort((a, b) => b[1].base - a[1].base);
  for (const [resource, amounts] of resources) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${esc(viResource(resource))}</td><td>${amounts.base.toLocaleString()}</td><td>${amounts.discounted.toLocaleString()}</td><td>${(amounts.base - amounts.discounted).toLocaleString()}</td>`;
    tbody.appendChild(tr);
  }
  if (resources.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="muted">Không cần thêm tài nguyên cho phần đang nâng.</td></tr>';
  }

  const levelBody = $("plannerLevelBody");
  levelBody.innerHTML = "";
  for (const detail of plan.details) {
    const tr = document.createElement("tr");
    const running = detail.running ? ' <span class="pill">Đang nâng</span>' : "";
    tr.innerHTML = `<td>${esc(detail.building)}${running}</td><td>${detail.fromLevel} → ${detail.toLevel}</td><td>${formatDuration(detail.baseTime)}</td><td>${formatDuration(detail.discountedTime)}</td><td>${finishClock(detail.finishAt)}</td>`;
    levelBody.appendChild(tr);
  }
}

function toggleSummerJam() {
  summerJamEnabled = !summerJamEnabled;
  const button = $("summerJamBtn");
  button.classList.toggle("active", summerJamEnabled);
  button.setAttribute("aria-pressed", String(summerJamEnabled));
  button.textContent = summerJamEnabled ? "Bỏ Summer Jam" : "Áp dụng Summer Jam";
  renderUpgradePlanner();
}

async function scheduleAll(successMessage = "") {
  const config = channelPayload();
  if (channel === "google" && !config.webhookUrl) {
    toast("Hãy nhập Google Chat webhook URL.");
    return false;
  }
  if (
    channel === "telegram" &&
    (!config.telegramBotToken || !config.telegramChatId)
  ) {
    toast("Hãy nhập Telegram bot token và chat id.");
    return false;
  }
  if (parsed.length === 0) {
    toast("Chưa có việc nào để đặt.");
    return false;
  }
  const tasks = parsed.map((t) => ({
    finishAt: t.finishAt,
    label: t.label,
    text: `${t.label} đã xong! (${finishClock(t.finishAt)})`,
  }));
  try {
    const res = await apiPost("/api/schedule", { ...config, tasks });
    // API thay toàn bộ lịch cũ bằng lịch mới; dùng kết quả trả về để hiện ngay.
    toast(successMessage || `Đã thay ${res.replaced || 0} lịch cũ và đặt ${res.scheduled} lịch mới.`);
    return true;
  } catch (e) {
    toast("Lỗi đặt lịch: " + e.message);
    return false;
  }
}

async function scheduleCurrentJson() {
  clearTimeout(jsonPreviewTimer);
  parseCurrentJson({ switchTab: false });
  const jsonText = $("json").value;
  if (await scheduleAll()) await saveJson(jsonText);
}

function clearPreview() {
  parsed = [];
  renderParsed();
  toast("Đã xóa preview.");
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

// Xóa JSON và preview cục bộ; chỉ lưu JSON lên server khi đặt lịch.
function clearJson() {
  clearTimeout(jsonPreviewTimer);
  $("json").value = "";
  parsed = [];
  plannerItems = [];
  renderParsed();
  renderUpgradePlannerOptions();
  toast("Đã xóa JSON.");
}

function openJsonPreview() {
  const jsonText = $("json").value.trim();
  if (!jsonText) return toast("Chưa có JSON để preview.");
  try {
    $("jsonPreviewContent").textContent = JSON.stringify(JSON.parse(jsonText), null, 2);
    $("jsonPreviewModal").hidden = false;
    document.body.classList.add("modal-open");
    $("closeJsonPreviewBtn").focus();
  } catch (e) {
    toast("JSON không hợp lệ: " + e.message);
  }
}

function closeJsonPreview() {
  $("jsonPreviewModal").hidden = true;
  document.body.classList.remove("modal-open");
  $("jsonPreviewBtn").focus();
}

function renderCountdowns() {
  if (!$("appView").hidden) {
    const now = displayNowSec();
    if (now === lastDisplayNow) return;
    lastDisplayNow = now;
    renderParsed();
  }
}

// ---- Wire ----
$("loginBtn").onclick = () => doAuth("/api/login");
$("registerBtn").onclick = () => doAuth("/api/register");
$("logoutBtn").onclick = logout;
$("mobileMenuBtn").onclick = () => setMobileMenuOpen(true);
$("mobileSidebarClose").onclick = () => setMobileMenuOpen(false);
$("sidebarOverlay").onclick = () => setMobileMenuOpen(false);
$("sidebarToggle").onclick = () => {
  const sidebar = $("sidebarToggle").closest(".sidebar");
  setSidebarCollapsed(!sidebar.classList.contains("collapsed"));
};
$("scheduleBtn").onclick = scheduleCurrentJson;
$("refreshBtn").onclick = doParse;
$("cancelAllBtn").onclick = clearPreview;
$("webhook").onchange = saveChannelConfig;
$("telegramBotToken").onchange = saveChannelConfig;
$("telegramChatId").onchange = saveChannelConfig;
$("json").oninput = () => {
  clearTimeout(jsonPreviewTimer);
  jsonPreviewTimer = setTimeout(
    () => parseCurrentJson({ switchTab: false, quiet: true }),
    300,
  );
};
$("clearJsonBtn").onclick = clearJson;
$("jsonPreviewBtn").onclick = openJsonPreview;
$("closeJsonPreviewBtn").onclick = closeJsonPreview;
$("jsonPreviewModal").onclick = (event) => {
  if (event.target === $("jsonPreviewModal")) closeJsonPreview();
};
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("jsonPreviewModal").hidden) closeJsonPreview();
  if (event.key === "Escape" && $("appSidebar").classList.contains("mobile-open")) {
    setMobileMenuOpen(false);
    $("mobileMenuBtn").focus();
  }
});
$("testWebhookBtn").onclick = testWebhook;
$("potionPreviewBtn").onclick = togglePotionPreview;
$("builderPotionCount").oninput = refreshPotionPreview;
$("researchPotionCount").oninput = refreshPotionPreview;
$("useBuilderPotionBtn").onclick = () =>
  usePotion("Thợ xây", ["buildings"], 10, "builderPotionCount", "Thuốc Thợ xây");
$("useResearchPotionBtn").onclick = () =>
  usePotion(
    "Lab",
    ["units", "units2", "spells", "siege_machines"],
    24,
    "researchPotionCount",
    "Thuốc Nghiên cứu",
  );
$("buildingSearch").onfocus = openBuildingOptions;
$("buildingSearch").onclick = () => $("buildingSearch").select();
$("buildingSearch").oninput = () => {
  plannerBuildingId = "";
  renderUpgradePlannerOptions($("buildingSearch").value);
  $("buildingOptions").hidden = false;
  $("buildingSearch").setAttribute("aria-expanded", "true");
};
document.addEventListener("click", (event) => {
  if (!$("buildingCombobox").contains(event.target)) closeBuildingOptions();
});
$("goldPassSelect").onchange = renderUpgradePlanner;
$("summerJamBtn").onclick = toggleSummerJam;
$("plannerTypeSelect").value = localStorage.getItem(LS_PLANNER_TYPE) || "building";
$("plannerResourceSelect").value = localStorage.getItem(LS_PLANNER_RESOURCE) || "Gold";
function updatePlannerFilters() {
  const building = $("plannerTypeSelect").value === "building";
  $("plannerResourceLabel").hidden = !building;
  $("plannerResourceSelect").hidden = !building;
  plannerBuildingId = "";
  $("buildingSearch").value = "";
  renderUpgradePlannerOptions();
}
$("plannerTypeSelect").onchange = () => {
  localStorage.setItem(LS_PLANNER_TYPE, $("plannerTypeSelect").value);
  updatePlannerFilters();
};
$("plannerResourceSelect").onchange = () => {
  localStorage.setItem(LS_PLANNER_RESOURCE, $("plannerResourceSelect").value);
  updatePlannerFilters();
};
updatePlannerFilters();
$("optimizerBuilderCount").value = localStorage.getItem(LS_OPTIMIZER_BUILDERS) || "5";
$("optimizerBuilderCount").oninput = () => {
  localStorage.setItem(LS_OPTIMIZER_BUILDERS, $("optimizerBuilderCount").value);
  renderSummerOptimizer();
};
$("optimizerGoldPass").onchange = renderSummerOptimizer;
for (const input of document.querySelectorAll('input[name="channel"]')) {
  input.onchange = () => {
    setChannel(input.value);
    saveChannelConfig();
  };
}
for (const button of document.querySelectorAll(".tab")) {
  button.onclick = () => {
    setActiveTab(button.dataset.tab || "parse");
    setMobileMenuOpen(false);
  };
}
window.matchMedia("(min-width: 901px)").addEventListener("change", (event) => {
  if (event.matches) setMobileMenuOpen(false);
});
resetClock();
setSidebarCollapsed(localStorage.getItem(LS_SIDEBAR_COLLAPSED) === "true");
setActiveTab(activeTab);
setInterval(renderCountdowns, 100);

// Tự vào app nếu còn token hợp lệ.
if (token) {
  enterApp().catch(() => logout());
}
