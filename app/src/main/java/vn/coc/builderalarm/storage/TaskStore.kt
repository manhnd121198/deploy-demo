package vn.coc.builderalarm.storage

import android.content.Context
import vn.coc.builderalarm.model.BuilderTask

/**
 * Lưu danh sách việc đã đặt báo thức vào SharedPreferences (JSON).
 * Dùng để BootReceiver khôi phục alarm sau khi khởi động lại máy,
 * và để xoá từng cái / xoá tất cả.
 */
class TaskStore(context: Context) {

    private val prefs = context.applicationContext
        .getSharedPreferences("scheduled_tasks", Context.MODE_PRIVATE)

    fun saveAll(tasks: List<BuilderTask>) {
        prefs.edit().putString(KEY, BuilderTask.listToJson(tasks)).apply()
    }

    fun loadAll(): List<BuilderTask> =
        BuilderTask.listFromJson(prefs.getString(KEY, "") ?: "")

    fun remove(taskId: Int) {
        saveAll(loadAll().filterNot { it.id == taskId })
    }

    fun clear() {
        prefs.edit().remove(KEY).apply()
    }

    companion object {
        private const val KEY = "tasks_json"
    }
}
