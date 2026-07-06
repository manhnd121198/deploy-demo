package vn.coc.builderalarm.ui

import android.content.Context
import vn.coc.builderalarm.alarm.AlarmScheduler
import vn.coc.builderalarm.model.BuilderTask
import vn.coc.builderalarm.parser.VillageJsonParser
import vn.coc.builderalarm.storage.InputStore
import vn.coc.builderalarm.storage.TaskStore

/** Gom logic parse + đặt/huỷ báo thức + lưu trữ cho màn hình chính. */
class BuilderAlarmController(context: Context) {

    private val scheduler = AlarmScheduler(context)
    private val store = TaskStore(context)
    private val inputStore = InputStore(context)

    fun canScheduleExact(): Boolean = scheduler.canScheduleExact()

    /** Parse JSON -> danh sách xem trước (chưa đặt báo thức). Ném khi JSON sai. */
    fun parse(json: String): List<BuilderTask> =
        VillageJsonParser.parse(json, nowSec())

    fun saveInput(json: String, webhookUrl: String) {
        inputStore.save(json, webhookUrl)
    }

    fun loadLastJson(): String = inputStore.loadJson()

    fun loadWebhookUrl(): String = inputStore.loadWebhookUrl()

    /** Đặt báo thức cho tất cả việc và lưu lại. */
    fun scheduleAll(tasks: List<BuilderTask>, webhookUrl: String) {
        tasks.forEach { scheduler.schedule(it, webhookUrl) }
        store.saveAll(tasks)
    }

    /** Huỷ đúng một việc và cập nhật store. */
    fun deleteOne(task: BuilderTask) {
        scheduler.cancel(task)
        store.remove(task.id)
    }

    /** Huỷ toàn bộ việc đang lưu. */
    fun clearAll(tasks: List<BuilderTask>) {
        tasks.forEach { scheduler.cancel(it) }
        store.clear()
    }

    fun loadSaved(): List<BuilderTask> = store.loadAll()

    fun nowSec(): Long = System.currentTimeMillis() / 1000
}
