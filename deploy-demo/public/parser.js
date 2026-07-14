// Port của VillageJsonParser.kt — trích timer đang chạy từ JSON "chia sẻ làng" CoC.
// Quy tắc: finishAt = timestamp + timer. Bỏ timer đã xong (finishAt <= now).
// Tra catalog theo field "data" để hiện tên và cấp đích.

class VillageParseError extends Error {}

function parseVillage(jsonText, nowSec, catalog) {
  let root;
  try {
    root = JSON.parse(jsonText);
  } catch {
    throw new VillageParseError("Không đọc được JSON");
  }
  if (typeof root !== "object" || root === null || Array.isArray(root)) {
    throw new VillageParseError("Không đọc được JSON");
  }
  if (!("timestamp" in root)) throw new VillageParseError("Thiếu 'timestamp'");
  const timestamp = Number(root.timestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new VillageParseError("'timestamp' không hợp lệ");
  }

  const tasks = [];
  let nextId = 1;
  const counters = {}; // đếm thứ tự riêng theo nhóm

  function add(category, timer, raw = {}) {
    timer = Number(timer);
    if (!Number.isFinite(timer) || timer <= 0) return;
    const finishAt = timestamp + timer;
    if (finishAt <= nowSec) return; // đã xong -> bỏ qua
    const n = (counters[category] || 0) + 1;
    counters[category] = n;
    const item = catalog?.items?.[String(raw.data)];
    const name = item?.nameVi || item?.name;
    const level = Number(raw.lvl || 0) + 1;
    tasks.push({
      id: nextId++,
      category,
      label: name ? `${name} ${level}` : `${category} #${n}`,
      finishAt,
    });
  }

  const arr = (key) => (Array.isArray(root[key]) ? root[key] : []);
  const withField = (key, field, category, useCatalog = false) => {
    for (const o of arr(key)) {
      if (o && typeof o === "object" && field in o) {
        add(category, o[field], useCatalog ? o : {});
      }
    }
  };

  // Mảng có field "timer".
  withField("buildings", "timer", "Thợ xây", true);
  withField("buildings2", "timer", "Builder Base", true);
  withField("units", "timer", "Lab", true);
  withField("units2", "timer", "Lab", true);
  withField("spells", "timer", "Lab", true);
  withField("siege_machines", "timer", "Lab", true);
  // Thợ phụ: field "helper_cooldown".
  withField("helpers", "helper_cooldown", "Thợ phụ");
  // Tháp đồng hồ: boosts.clocktower_cooldown.
  if (root.boosts && typeof root.boosts === "object") {
    add("Tháp đồng hồ", root.boosts.clocktower_cooldown || 0);
  }

  tasks.sort((a, b) => a.finishAt - b.finishAt);
  return tasks;
}

function parseVillageItems(jsonText, catalog) {
  const root = JSON.parse(jsonText);
  const timestamp = Number(root.timestamp || 0);
  const items = catalog?.items || {};
  const out = [];
  let nextId = 1;
  const townHallLevel = findLevel("buildings", 1000001);
  const builderHallLevel = findLevel("buildings2", 1000034);
  const laboratoryLevel = findLevel("buildings", 1000007);
  const petHouseLevel = findLevel("buildings", 1000068);
  const blacksmithLevel = findLevel("buildings", 1000070);
  const heroHallLevel = findLevel("buildings", 1000071);
  const sources = [
    ["buildings", "Công trình làng chính", "home"],
    ["traps", "Bẫy làng chính", "home"],
    ["units", "Quân lính", "home"],
    ["siege_machines", "Máy công thành", "home"],
    ["heroes", "Anh hùng", "home"],
    ["spells", "Thần chú", "home"],
    ["pets", "Thú cưng", "home"],
    ["equipment", "Trang bị anh hùng", "home"],
    ["guardians", "Hộ vệ", "home"],
    ["helpers", "Trợ thủ", "home"],
    ["buildings2", "Công trình căn cứ thợ xây", "builder"],
    ["traps2", "Bẫy căn cứ thợ xây", "builder"],
    ["units2", "Quân căn cứ thợ xây", "builder"],
    ["heroes2", "Anh hùng căn cứ thợ xây", "builder"],
  ];

  function imageForLevel(item, currentLevel) {
    const levels = Array.isArray(item?.levels) ? item.levels : [];
    let selected = null;
    for (const level of levels) {
      const levelNo = Number(level.level || 0);
      if (levelNo > currentLevel) break;
      if (level.imageUrl) selected = level.imageUrl;
    }
    return selected || item?.imageUrl || "";
  }

  function findLevel(arrayKey, dataId) {
    const arr = Array.isArray(root[arrayKey]) ? root[arrayKey] : [];
    const raw = arr.find((entry) => entry && typeof entry === "object" && Number(entry.data) === dataId);
    return raw ? Number(raw.lvl || 0) : 0;
  }

  function isAllowedAtCurrentHall(level, village, item) {
    if (item?.kind === "town-hall" || item?.kind === "builder-hall") {
      const cap = village === "builder" ? builderHallLevel : townHallLevel;
      return Number(level.level || 0) <= cap;
    }
    if (village === "home" && townHallLevel > 0 && Number(level.townHall || 0) > townHallLevel) return false;
    if (village === "builder" && builderHallLevel > 0 && Number(level.builderHall || 0) > builderHallLevel) return false;
    if (laboratoryLevel > 0 && Number(level.laboratory || 0) > laboratoryLevel) return false;
    if (petHouseLevel > 0 && Number(level.petHouse || 0) > petHouseLevel) return false;
    if (blacksmithLevel > 0 && Number(level.blacksmith || 0) > blacksmithLevel) return false;
    if (heroHallLevel > 0 && Number(level.heroHall || 0) > heroHallLevel) return false;
    return true;
  }

  function addFromArray(arrayKey, sourceLabel, village) {
    const arr = Array.isArray(root[arrayKey]) ? root[arrayKey] : [];
    for (const raw of arr) {
      if (!raw || typeof raw !== "object" || !("data" in raw)) continue;
      const dataId = String(raw.data);
      const item = items[dataId];
      const currentLevel = Number(raw.lvl || 0);
      const count = Math.max(1, Number(raw.cnt || 1));
      const levels = Array.isArray(item?.levels) ? item.levels : [];
      const availableLevels = levels.filter((level) => isAllowedAtCurrentHall(level, village, item));
      const maxLevel = availableLevels.reduce((max, level) => Math.max(max, Number(level.level || 0)), currentLevel);
      const remainingLevels = availableLevels.filter((level) => Number(level.level || 0) > currentLevel);
      const nextLevel = remainingLevels[0] || null;
      const totalTimeSec = remainingLevels.reduce((sum, level) => sum + Number(level.timeSec || 0) * count, 0);
      const remainingDurations = [];
      for (const level of remainingLevels) {
        const duration = Number(level.timeSec || 0);
        for (let i = 0; i < count; i += 1) {
          if (duration > 0) remainingDurations.push(duration);
        }
      }
      const costs = {};
      for (const level of remainingLevels) {
        const levelCosts = level.costs && typeof level.costs === "object"
          ? level.costs
          : { [level.resource || "Unknown"]: Number(level.cost || 0) };
        for (const [resource, value] of Object.entries(levelCosts)) {
          const amount = Number(value || 0) * count;
          if (amount > 0) costs[resource] = (costs[resource] || 0) + amount;
        }
      }
      out.push({
        id: nextId++,
        dataId,
        village,
        source: sourceLabel,
        name: item?.name || `ID ${dataId}`,
        displayName: item?.nameVi || item?.name || `ID ${dataId}`,
        imageUrl: imageForLevel(item, currentLevel),
        matched: Boolean(item),
        currentLevel,
        maxLevel,
        townHallLevel,
        builderHallLevel,
        count,
        nextLevel,
        remainingLevels: remainingLevels.length,
        upgradeLevels: remainingLevels.map((level) => ({ ...level, count })),
        totalTimeSec,
        remainingDurations,
        costs,
        timer: Number(raw.timer || 0),
        finishAt: raw.timer && timestamp ? timestamp + Number(raw.timer) : 0,
      });
    }
  }

  for (const [arrayKey, sourceLabel, village] of sources) {
    addFromArray(arrayKey, sourceLabel, village);
  }

  out.sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
  return out;
}

// Giờ xong đầy đủ dạng HH:mm dd/MM/yyyy theo múi giờ trình duyệt.
function finishClock(finishAt) {
  const d = new Date(finishAt * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Thời gian còn lại dạng HH:mm:ss, giờ có thể lớn hơn 24.
function remaining(finishAt, nowSec) {
  let s = Math.floor(finishAt - nowSec);
  if (s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(sec)}`;
}

function formatDuration(totalSec) {
  let s = Math.max(0, Math.floor(totalSec || 0));
  const d = Math.floor(s / 86400);
  s %= 86400;
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function formatCosts(costs) {
  const entries = Object.entries(costs || {}).filter(([, value]) => value > 0);
  if (entries.length === 0) return "-";
  return entries.map(([resource, value]) => `${formatResource(resource)}: ${Number(value).toLocaleString()}`).join(", ");
}

function formatLevelCosts(level) {
  if (!level) return "-";
  if (level.costs && typeof level.costs === "object") return formatCosts(level.costs);
  if (!level.resource || !level.cost) return "-";
  return `${formatResource(level.resource)}: ${Number(level.cost || 0).toLocaleString()}`;
}

function formatResource(resource) {
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

function parallelDuration(durations, workerCount) {
  const workers = Array.from({ length: Math.max(1, Math.floor(workerCount || 1)) }, () => 0);
  const jobs = (durations || []).filter((duration) => Number(duration || 0) > 0);
  jobs.sort((a, b) => b - a);
  for (const duration of jobs) {
    let index = 0;
    for (let i = 1; i < workers.length; i += 1) {
      if (workers[i] < workers[index]) index = i;
    }
    workers[index] += Number(duration);
  }
  return Math.max(0, ...workers);
}
