package vn.coc.builderalarm.alarm

import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/** Gửi text message đơn giản tới Google Chat incoming webhook. */
object GoogleChatWebhookClient {

    fun send(webhookUrl: String, text: String) {
        val connection = (URL(webhookUrl).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 5_000
            readTimeout = 5_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json; charset=UTF-8")
        }

        try {
            OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { writer ->
                writer.write(JSONObject().put("text", text).toString())
            }
            if (connection.responseCode !in 200..299) {
                throw IllegalStateException("Google Chat webhook HTTP ${connection.responseCode}")
            }
        } finally {
            connection.disconnect()
        }
    }
}
