// Port của VillageJsonParser.kt — trích timer đang chạy từ JSON "chia sẻ làng" CoC.
// Quy tắc: finishAt = timestamp + timer đã tính trợ giúp. Bỏ timer đã xong (finishAt <= now).
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
  const builderApprenticeLevel = Number(arr("helpers").find((o) => Number(o?.data) === 93000000)?.lvl || 0);
  const adjustedBuilderTimer = (timer, helperTimer) => {
    timer = Number(timer);
    helperTimer = Number(helperTimer) || 0;
    if (timer <= 0 || helperTimer <= 0 || builderApprenticeLevel <= 0) return timer;
    const boostedSpeed = builderApprenticeLevel + 1;
    return timer <= helperTimer * boostedSpeed
      ? Math.ceil(timer / boostedSpeed)
      : timer - helperTimer * builderApprenticeLevel;
  };
  const withField = (key, field, category, useBuilderHelper = false) => {
    for (const o of arr(key)) {
      if (o && typeof o === "object" && field in o) {
        add(category, useBuilderHelper ? adjustedBuilderTimer(o[field], o.helper_timer) : o[field]);
      }
    }
  };

  // Mảng có field "timer".
  withField("buildings", "timer", "Thợ xây", true);
  withField("heroes", "timer", "Thợ xây", true);
  withField("buildings2", "timer", "Builder Base");
  withField("heroes2", "timer", "Builder Base");
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
