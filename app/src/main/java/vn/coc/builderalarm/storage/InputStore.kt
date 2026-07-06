package vn.coc.builderalarm.storage

import android.content.Context

/** Lưu JSON và webhook URL lần cuối để mở app/reload không phải dán lại. */
class InputStore(context: Context) {

    private val prefs = context.applicationContext
        .getSharedPreferences("last_input", Context.MODE_PRIVATE)

    fun save(json: String, webhookUrl: String) {
        prefs.edit()
            .putString(KEY_JSON, json)
            .putString(KEY_WEBHOOK_URL, webhookUrl)
            .apply()
    }

    fun loadJson(): String = prefs.getString(KEY_JSON, "") ?: ""

    fun loadWebhookUrl(): String = prefs.getString(KEY_WEBHOOK_URL, "") ?: ""

    companion object {
        private const val KEY_JSON = "json"
        private const val KEY_WEBHOOK_URL = "webhook_url"
    }
}
