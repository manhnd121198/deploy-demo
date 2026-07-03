package vn.coc.builderalarm.model

import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Một việc đang chạy trích từ dữ liệu làng CoC.
 *
 * @param id requestCode duy nhất, dùng để đặt/huỷ đúng alarm.
 * @param category loại timer, vd "Thợ xây", "Lab".
 * @param label nhãn hiển thị đã đánh số, vd "Thợ xây #3".
 * @param finishAtEpochSec thời điểm hoàn thành (epoch giây).
 */
data class BuilderTask(
    val id: Int,
    val category: String,
    val label: String,
    val finishAtEpochSec: Long
) {
    /** Giờ xong dạng HH:mm theo múi giờ máy. */
    fun finishClock(): String =
        SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(finishAtEpochSec * 1000))

    /** Thời gian còn lại dạng "2h19m" / "45m" / "30s" tính từ nowSec. */
    fun remaining(nowSec: Long): String {
        var s = finishAtEpochSec - nowSec
        if (s < 0) s = 0
        val h = s / 3600
        val m = (s % 3600) / 60
        val sec = s % 60
        return when {
            h > 0 -> "${h}h${m}m"
            m > 0 -> "${m}m"
            else -> "${sec}s"
        }
    }

    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("category", category)
        .put("label", label)
        .put("finishAtEpochSec", finishAtEpochSec)

    companion object {
        fun fromJson(o: JSONObject) = BuilderTask(
            id = o.getInt("id"),
            category = o.getString("category"),
            label = o.getString("label"),
            finishAtEpochSec = o.getLong("finishAtEpochSec")
        )

        fun listToJson(tasks: List<BuilderTask>): String {
            val arr = JSONArray()
            tasks.forEach { arr.put(it.toJson()) }
            return arr.toString()
        }

        fun listFromJson(json: String): List<BuilderTask> {
            if (json.isBlank()) return emptyList()
            val arr = JSONArray(json)
            return (0 until arr.length()).map { fromJson(arr.getJSONObject(it)) }
        }
    }
}
