package vn.coc.builderalarm.parser

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import vn.coc.builderalarm.model.BuilderTask

/** Lỗi khi dữ liệu JSON làng không hợp lệ / thiếu field bắt buộc. */
class VillageParseException(message: String) : Exception(message)

/**
 * Trích các timer đang chạy từ JSON "chia sẻ làng" của Clash of Clans.
 *
 * Quy tắc: finishAt = timestamp + timer. Bỏ qua timer đã xong (finishAt <= now).
 * Chỉ phân loại theo nguồn, không tra tên công trình.
 */
object VillageJsonParser {

    fun parse(json: String, nowEpochSec: Long): List<BuilderTask> {
        val root = try {
            JSONObject(json)
        } catch (e: JSONException) {
            throw VillageParseException("Không đọc được JSON")
        }

        if (!root.has("timestamp")) {
            throw VillageParseException("Thiếu 'timestamp'")
        }
        val timestamp = root.optLong("timestamp", -1L)
        if (timestamp <= 0L) throw VillageParseException("'timestamp' không hợp lệ")

        val tasks = mutableListOf<BuilderTask>()
        var nextId = 1
        // Đếm thứ tự riêng cho từng nhóm.
        val counters = mutableMapOf<String, Int>()

        fun add(category: String, timer: Long) {
            if (timer <= 0L) return
            val finishAt = timestamp + timer
            if (finishAt <= nowEpochSec) return // đã xong -> bỏ qua
            val n = (counters[category] ?: 0) + 1
            counters[category] = n
            tasks.add(
                BuilderTask(
                    id = nextId++,
                    category = category,
                    label = "$category #$n",
                    finishAtEpochSec = finishAt
                )
            )
        }

        // Mảng có field "timer".
        forEachTimer(root, "buildings") { add("Thợ xây", it) }
        forEachTimer(root, "buildings2") { add("Builder Base", it) }
        forEachTimer(root, "units") { add("Lab", it) }
        forEachTimer(root, "units2") { add("Lab", it) }

        // Thợ phụ: field "helper_cooldown".
        forEachField(root, "helpers", "helper_cooldown") { add("Thợ phụ", it) }

        // Tháp đồng hồ: boosts.clocktower_cooldown.
        root.optJSONObject("boosts")?.let { boosts ->
            add("Tháp đồng hồ", boosts.optLong("clocktower_cooldown", 0L))
        }

        // Sắp xếp theo giờ xong tăng dần cho dễ nhìn.
        return tasks.sortedBy { it.finishAtEpochSec }
    }

    private inline fun forEachTimer(root: JSONObject, key: String, add: (Long) -> Unit) =
        forEachField(root, key, "timer", add)

    private inline fun forEachField(
        root: JSONObject,
        arrayKey: String,
        field: String,
        add: (Long) -> Unit
    ) {
        val arr: JSONArray = root.optJSONArray(arrayKey) ?: return
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.has(field)) add(o.optLong(field, 0L))
        }
    }
}
