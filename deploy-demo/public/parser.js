// Port của VillageJsonParser.kt — trích timer đang chạy từ JSON "chia sẻ làng" CoC.
// Quy tắc: finishAt = timestamp + timer. Bỏ timer đã xong (finishAt <= now).
// Chỉ phân loại theo nguồn, không tra tên công trình.

class VillageParseError extends Error {}

function parseVillage(jsonText, nowSec) {
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

  function add(category, timer) {
    timer = Number(timer);
    if (!Number.isFinite(timer) || timer <= 0) return;
    const finishAt = timestamp + timer;
    if (finishAt <= nowSec) return; // đã xong -> bỏ qua
    const n = (counters[category] || 0) + 1;
    counters[category] = n;
    tasks.push({ id: nextId++, category, label: `${category} #${n}`, finishAt });
  }

  const arr = (key) => (Array.isArray(root[key]) ? root[key] : []);
  const withField = (key, field, category) => {
    for (const o of arr(key)) if (o && typeof o === "object" && field in o) add(category, o[field]);
  };

  // Mảng có field "timer".
  withField("buildings", "timer", "Thợ xây");
  withField("buildings2", "timer", "Builder Base");
  withField("units", "timer", "Lab");
  withField("units2", "timer", "Lab");
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
    ["buildings", "Home Buildings", "home"],
    ["traps", "Home Traps", "home"],
    ["units", "Home Troops", "home"],
    ["siege_machines", "Siege Machines", "home"],
    ["heroes", "Home Heroes", "home"],
    ["spells", "Home Spells", "home"],
    ["pets", "Hero Pets", "home"],
    ["equipment", "Hero Equipment", "home"],
    ["guardians", "Guardians", "home"],
    ["helpers", "Helpers", "home"],
    ["buildings2", "Builder Buildings", "builder"],
    ["traps2", "Builder Traps", "builder"],
    ["units2", "Builder Troops", "builder"],
    ["heroes2", "Builder Heroes", "builder"],
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
        totalTimeSec,
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

// Thời gian còn lại, luôn hiện tới giây: "2h19m05s" / "45m30s" / "30s".
function remaining(finishAt, nowSec) {
  let s = Math.floor(finishAt - nowSec);
  if (s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  if (h > 0) return `${h}h${p(m)}m${p(sec)}s`;
  if (m > 0) return `${m}m${p(sec)}s`;
  return `${sec}s`;
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
  return entries.map(([resource, value]) => `${resource}: ${Number(value).toLocaleString()}`).join(", ");
}

function formatLevelCosts(level) {
  if (!level) return "-";
  if (level.costs && typeof level.costs === "object") return formatCosts(level.costs);
  if (!level.resource || !level.cost) return "-";
  return `${level.resource}: ${Number(level.cost || 0).toLocaleString()}`;
}
