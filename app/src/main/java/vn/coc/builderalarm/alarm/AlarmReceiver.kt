package vn.coc.builderalarm.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import vn.coc.builderalarm.storage.TaskStore

/** Tới giờ: khởi động service rung liên tục, rồi bỏ việc khỏi store. */
class AlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val taskId = intent.getIntExtra(EXTRA_TASK_ID, -1)
        val label = intent.getStringExtra(EXTRA_LABEL) ?: "Việc"

        val serviceIntent = Intent(context, AlarmVibrationService::class.java).apply {
            action = AlarmVibrationService.ACTION_START
            putExtra(AlarmVibrationService.EXTRA_LABEL, label)
        }
        ContextCompat.startForegroundService(context, serviceIntent)

        // Việc đã hoàn tất -> gỡ khỏi danh sách lưu.
        if (taskId >= 0) TaskStore(context).remove(taskId)
    }

    companion object {
        const val EXTRA_TASK_ID = "task_id"
        const val EXTRA_LABEL = "label"
    }
}
