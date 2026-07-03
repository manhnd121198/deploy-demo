package vn.coc.builderalarm.alarm

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import vn.coc.builderalarm.R
import vn.coc.builderalarm.storage.TaskStore

/** Tới giờ: rung + hiện notification (không âm thanh), rồi bỏ việc khỏi store. */
class AlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val taskId = intent.getIntExtra(EXTRA_TASK_ID, -1)
        val label = intent.getStringExtra(EXTRA_LABEL) ?: "Việc"

        ensureChannel(context)
        vibrate(context)

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("$label đã xong!")
            .setContentText("Công việc trong Clash of Clans đã hoàn thành.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVibrate(VIBRATE_PATTERN)
            .setAutoCancel(true)
            .build()

        val manager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // id notification riêng theo task để nhiều việc không đè nhau.
        manager.notify(taskId.coerceAtLeast(0), notification)

        // Việc đã hoàn tất -> gỡ khỏi danh sách lưu.
        if (taskId >= 0) TaskStore(context).remove(taskId)
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Báo thức thợ xây",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Rung khi công việc hoàn thành"
            enableVibration(true)
            vibrationPattern = VIBRATE_PATTERN
            setSound(null, null) // chỉ rung, không âm thanh
        }
        manager.createNotificationChannel(channel)
    }

    @Suppress("DEPRECATION")
    private fun vibrate(context: Context) {
        val vibrator: Vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm =
                context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vm.defaultVibrator
        } else {
            context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(VIBRATE_PATTERN, -1))
        } else {
            vibrator.vibrate(VIBRATE_PATTERN, -1)
        }
    }

    companion object {
        const val EXTRA_TASK_ID = "task_id"
        const val EXTRA_LABEL = "label"
        private const val CHANNEL_ID = "builder_done"
        // chờ, rung, nghỉ, rung...
        private val VIBRATE_PATTERN = longArrayOf(0, 600, 300, 600, 300, 600)
    }
}
