package vn.coc.builderalarm.alarm

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import vn.coc.builderalarm.R
import vn.coc.builderalarm.ui.MainActivity

/**
 * Rung liên tục (lặp) khi có việc hoàn thành, chạy dạng foreground service để
 * không bị hệ thống cắt. Dừng khi người dùng bấm "Tắt" trên notification hoặc mở app.
 */
class AlarmVibrationService : Service() {

    private var vibrator: Vibrator? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopEverything()
                return START_NOT_STICKY
            }
            else -> {
                val label = intent?.getStringExtra(EXTRA_LABEL) ?: "Việc"
                startForeground(NOTIF_ID, buildNotification(label))
                startLoopingVibration()
            }
        }
        return START_STICKY
    }

    private fun startLoopingVibration() {
        val v = obtainVibrator()
        vibrator = v
        // repeat = index 0 -> lặp vô hạn cho tới khi cancel().
        v.vibrate(VibrationEffect.createWaveform(VIBRATE_PATTERN, 0))
    }

    private fun stopEverything() {
        vibrator?.cancel()
        vibrator = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        vibrator?.cancel()
        super.onDestroy()
    }

    private fun obtainVibrator(): Vibrator =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }

    private fun buildNotification(label: String): android.app.Notification {
        ensureChannel()

        val stopIntent = Intent(this, AlarmVibrationService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPending = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val openPending = PendingIntent.getActivity(
            this, 2, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("$label đã xong!")
            .setContentText("Đang rung — bấm Tắt để dừng.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setOngoing(true)
            .setContentIntent(openPending)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Tắt", stopPending)
            .build()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Báo thức thợ xây",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Rung khi công việc hoàn thành"
            setSound(null, null)   // chỉ rung, không âm thanh
            enableVibration(false) // rung do service tự điều khiển, tránh rung 2 lớp
        }
        manager.createNotificationChannel(channel)
    }

    companion object {
        const val ACTION_START = "vn.coc.builderalarm.START_VIBRATION"
        const val ACTION_STOP = "vn.coc.builderalarm.STOP_VIBRATION"
        const val EXTRA_LABEL = "label"

        private const val CHANNEL_ID = "builder_done"
        private const val NOTIF_ID = 1001

        // chờ 0, rung 700, nghỉ 500 -> lặp lại.
        private val VIBRATE_PATTERN = longArrayOf(0, 700, 500)

        /** Tiện ích để MainActivity dừng rung khi mở app. */
        fun stop(context: Context) {
            val intent = Intent(context, AlarmVibrationService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }
    }
}
