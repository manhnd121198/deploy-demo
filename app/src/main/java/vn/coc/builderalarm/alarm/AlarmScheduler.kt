package vn.coc.builderalarm.alarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import vn.coc.builderalarm.model.BuilderTask

/** Đặt/huỷ báo thức chính xác cho từng việc qua AlarmManager. */
class AlarmScheduler(context: Context) {

    private val appContext = context.applicationContext
    private val alarmManager =
        appContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    /** Android 12+ cần quyền đặt exact alarm; bản cũ luôn true. */
    fun canScheduleExact(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            alarmManager.canScheduleExactAlarms()
        } else {
            true
        }

    fun schedule(task: BuilderTask, webhookUrl: String) {
        val triggerAtMs = task.finishAtEpochSec * 1000
        alarmManager.setExactAndAllowWhileIdle(
            AlarmManager.RTC_WAKEUP,
            triggerAtMs,
            pendingIntent(task, webhookUrl)
        )
    }

    fun cancel(task: BuilderTask) {
        alarmManager.cancel(pendingIntent(task, ""))
    }

    private fun pendingIntent(task: BuilderTask, webhookUrl: String): PendingIntent {
        val intent = Intent(appContext, AlarmReceiver::class.java).apply {
            putExtra(AlarmReceiver.EXTRA_TASK_ID, task.id)
            putExtra(AlarmReceiver.EXTRA_LABEL, task.label)
            putExtra(AlarmReceiver.EXTRA_FINISH_AT, task.finishAtEpochSec)
            putExtra(AlarmReceiver.EXTRA_WEBHOOK_URL, webhookUrl)
        }
        return PendingIntent.getBroadcast(
            appContext,
            task.id, // requestCode duy nhất theo việc
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
}
