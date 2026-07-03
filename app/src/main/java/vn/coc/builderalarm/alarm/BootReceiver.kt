package vn.coc.builderalarm.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import vn.coc.builderalarm.storage.TaskStore

/** Sau khi khởi động lại máy, đặt lại các alarm còn hạn và dọn việc đã quá giờ. */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        val store = TaskStore(context)
        val scheduler = AlarmScheduler(context)
        val nowSec = System.currentTimeMillis() / 1000

        val stillPending = store.loadAll().filter { it.finishAtEpochSec > nowSec }
        stillPending.forEach { scheduler.schedule(it) }
        store.saveAll(stillPending)
    }
}
