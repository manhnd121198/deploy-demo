package vn.coc.builderalarm.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import vn.coc.builderalarm.model.BuilderTask
import vn.coc.builderalarm.parser.VillageParseException

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            AppTheme {
                MainScreen()
            }
        }
    }
}

@Composable
private fun MainScreen() {
    val context = LocalContext.current
    val controller = remember { BuilderAlarmController(context) }

    var jsonText by remember { mutableStateOf(controller.loadLastJson()) }
    var webhookUrl by remember { mutableStateOf(controller.loadWebhookUrl()) }
    var tasks by remember { mutableStateOf(controller.loadSaved()) }
    var nowSec by remember { mutableLongStateOf(controller.nowSec()) }
    var screen by remember { mutableStateOf(if (tasks.isEmpty()) Screen.Input else Screen.Preview) }
    var scheduled by remember { mutableStateOf(tasks.isNotEmpty()) }

    fun toast(msg: String) = Toast.makeText(context, msg, Toast.LENGTH_LONG).show()

    fun parseAndShow() {
        try {
            val parsed = controller.parse(jsonText)
            controller.saveInput(jsonText, webhookUrl)
            tasks = parsed
            nowSec = controller.nowSec()
            scheduled = false
            screen = Screen.Preview
            if (parsed.isEmpty()) toast("Không có việc nào đang chạy.")
        } catch (e: VillageParseException) {
            toast("Dữ liệu không hợp lệ: ${e.message}")
        } catch (e: Exception) {
            toast("Dữ liệu không hợp lệ.")
        }
    }

    Scaffold { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
        ) {
            Text(
                "CoC Builder Alarm",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.height(12.dp))

            when (screen) {
                Screen.Input -> InputScreen(
                    jsonText = jsonText,
                    onJsonChange = { jsonText = it },
                    webhookUrl = webhookUrl,
                    onWebhookChange = { webhookUrl = it },
                    onParse = { parseAndShow() }
                )

                Screen.Preview -> PreviewScreen(
                    tasks = tasks,
                    nowSec = nowSec,
                    scheduled = scheduled,
                    onReload = {
                        try {
                            tasks = controller.parse(jsonText)
                            nowSec = controller.nowSec()
                            controller.saveInput(jsonText, webhookUrl)
                            if (tasks.isEmpty()) scheduled = false
                        } catch (e: Exception) {
                            toast("Không reload được vì JSON đang không hợp lệ.")
                        }
                    },
                    onSchedule = {
                        if (webhookUrl.isBlank()) {
                            toast("Hãy nhập Google Chat webhook URL.")
                            return@PreviewScreen
                        }
                        if (!controller.canScheduleExact()) {
                            openExactAlarmSettings(context)
                            toast("Hãy cấp quyền báo thức chính xác rồi bấm lại.")
                            return@PreviewScreen
                        }
                        controller.saveInput(jsonText, webhookUrl)
                        controller.scheduleAll(tasks, webhookUrl)
                        scheduled = true
                        toast("Đã đặt ${tasks.size} tin nhắn Google Chat.")
                    },
                    onDelete = { task ->
                        controller.deleteOne(task)
                        tasks = tasks.filterNot { it.id == task.id }
                        if (tasks.isEmpty()) scheduled = false
                    },
                    onClearAll = {
                        controller.clearAll(tasks)
                        tasks = emptyList()
                        scheduled = false
                        toast("Đã xoá tất cả.")
                    },
                    onBack = { screen = Screen.Input }
                )
            }
        }
    }
}

@Composable
private fun ColumnScope.InputScreen(
    jsonText: String,
    onJsonChange: (String) -> Unit,
    webhookUrl: String,
    onWebhookChange: (String) -> Unit,
    onParse: () -> Unit
) {
    OutlinedTextField(
        value = webhookUrl,
        onValueChange = onWebhookChange,
        label = { Text("Google Chat webhook URL") },
        singleLine = true,
        trailingIcon = {
            if (webhookUrl.isNotEmpty()) {
                IconButton(onClick = { onWebhookChange("") }) {
                    Icon(Icons.Filled.Clear, contentDescription = "Xoá webhook")
                }
            }
        },
        modifier = Modifier.fillMaxWidth()
    )
    Spacer(Modifier.height(8.dp))

    OutlinedTextField(
        value = jsonText,
        onValueChange = onJsonChange,
        label = { Text("Dán JSON làng vào đây") },
        trailingIcon = {
            if (jsonText.isNotEmpty()) {
                IconButton(onClick = { onJsonChange("") }) {
                    Icon(Icons.Filled.Clear, contentDescription = "Xoá JSON")
                }
            }
        },
        modifier = Modifier
            .fillMaxWidth()
            .weight(1f)
    )
    Spacer(Modifier.height(8.dp))

    Button(onClick = onParse, modifier = Modifier.fillMaxWidth()) {
        Text("Parse & Xem thời gian")
    }
}

@Composable
private fun PreviewScreen(
    tasks: List<BuilderTask>,
    nowSec: Long,
    scheduled: Boolean,
    onReload: () -> Unit,
    onSchedule: () -> Unit,
    onDelete: (BuilderTask) -> Unit,
    onClearAll: () -> Unit,
    onBack: () -> Unit
) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = onBack, modifier = Modifier.weight(1f)) {
            Text("Sửa JSON")
        }
        OutlinedButton(onClick = onReload, modifier = Modifier.weight(1f)) {
            Text("Reload")
        }
    }
    Spacer(Modifier.height(8.dp))

    if (tasks.isNotEmpty()) {
        Button(onClick = onSchedule, modifier = Modifier.fillMaxWidth()) {
            Text("Đặt gửi Chat tất cả (${tasks.size})")
        }
        Spacer(Modifier.height(8.dp))
    }

    if (scheduled && tasks.isNotEmpty()) {
        Text("Đã đặt lịch gửi Google Chat.", style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(8.dp))
    }

    if (tasks.isNotEmpty()) {
        OutlinedButton(onClick = onClearAll, modifier = Modifier.fillMaxWidth()) {
            Text("Xoá tất cả")
        }
        Spacer(Modifier.height(8.dp))
    }

    TaskTable(tasks = tasks, nowSec = nowSec, onDelete = onDelete)
}

@Composable
private fun TaskTable(
    tasks: List<BuilderTask>,
    nowSec: Long,
    onDelete: (BuilderTask) -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        TableHeader()
        HorizontalDivider()
        LazyColumn {
            items(tasks, key = { it.id }) { task ->
                TableRow(task = task, nowSec = nowSec, onDelete = { onDelete(task) })
                HorizontalDivider()
            }
        }
    }
}

@Composable
private fun TableHeader() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text("Việc", modifier = Modifier.weight(1.4f), fontWeight = FontWeight.Bold)
        Text("Còn lại", modifier = Modifier.weight(1f), fontWeight = FontWeight.Bold)
        Text("Xong", modifier = Modifier.weight(1.2f), fontWeight = FontWeight.Bold)
        Spacer(Modifier.weight(0.4f))
    }
}

@Composable
private fun TableRow(task: BuilderTask, nowSec: Long, onDelete: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(task.label, modifier = Modifier.weight(1.4f))
        Text(task.remaining(nowSec), modifier = Modifier.weight(1f))
        Text(task.finishClock(), modifier = Modifier.weight(1.2f))
        IconButton(onClick = onDelete, modifier = Modifier.weight(0.4f)) {
            Icon(Icons.Filled.Delete, contentDescription = "Xoá")
        }
    }
}

private enum class Screen {
    Input,
    Preview
}

private fun openExactAlarmSettings(context: Context) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val intent = Intent(
            Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
            Uri.parse("package:${context.packageName}")
        )
        context.startActivity(intent)
    }
}
