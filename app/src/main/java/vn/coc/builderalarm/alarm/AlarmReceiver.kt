package vn.coc.builderalarm.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import vn.coc.builderalarm.storage.TaskStore
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Tới giờ: gửi tin nhắn Google Chat, rồi bỏ việc khỏi store. */
class AlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val taskId = intent.getIntExtra(EXTRA_TASK_ID, -1)
        val label = intent.getStringExtra(EXTRA_LABEL) ?: "Việc"
        val finishAt = intent.getLongExtra(EXTRA_FINISH_AT, 0L)
        val webhookUrl = intent.getStringExtra(EXTRA_WEBHOOK_URL).orEmpty()

        val pendingResult = goAsync()
        Thread {
            try {
                if (webhookUrl.isNotBlank()) {
                    GoogleChatWebhookClient.send(
                        webhookUrl,
                        "$label đã xong! (${formatFinishAt(finishAt)})"
                    )
                }
            } finally {
                // Việc đã tới giờ -> gỡ khỏi danh sách lưu, kể cả gửi webhook lỗi.
                if (taskId >= 0) TaskStore(context).remove(taskId)
                pendingResult.finish()
            }
        }.start()
    }

    private fun formatFinishAt(finishAt: Long): String =
        if (finishAt > 0L) {
            SimpleDateFormat("HH:mm dd/MM/yyyy", Locale.getDefault())
                .format(Date(finishAt * 1000))
        } else {
            "đã tới giờ"
        }

    companion object {
        const val EXTRA_TASK_ID = "task_id"
        const val EXTRA_LABEL = "label"
        const val EXTRA_FINISH_AT = "finish_at"
        const val EXTRA_WEBHOOK_URL = "webhook_url"
    }
}
