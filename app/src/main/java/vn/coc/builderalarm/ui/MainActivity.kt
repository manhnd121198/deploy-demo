package vn.coc.builderalarm.ui

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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

        // Xin quyền hiện notification (Android 13+); không chặn app nếu bị từ chối.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerForActivityResult(ActivityResultContracts.RequestPermission()) {}
                .launch(Manifest.permission.POST_NOTIFICATIONS)
        }

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

    var jsonText by remember { mutableStateOf("") }
    var tasks by remember { mutableStateOf(controller.loadSaved()) }
    var scheduled by remember { mutableStateOf(controller.loadSaved().isNotEmpty()) }

    fun toast(msg: String) = Toast.makeText(context, msg, Toast.LENGTH_LONG).show()

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

            OutlinedTextField(
                value = jsonText,
                onValueChange = { jsonText = it },
                label = { Text("Dán JSON làng vào đây") },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(140.dp)
            )
            Spacer(Modifier.height(8.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = {
                    try {
                        tasks = controller.parse(jsonText)
                        scheduled = false
                        if (tasks.isEmpty()) toast("Không có việc nào đang chạy.")
                    } catch (e: VillageParseException) {
                        toast("Dữ liệu không hợp lệ: ${e.message}")
                    } catch (e: Exception) {
                        toast("Dữ liệu không hợp lệ.")
                    }
                }) { Text("Parse & Xem trước") }

                if (tasks.isNotEmpty()) {
                    OutlinedButton(onClick = {
                        controller.clearAll(tasks)
                        tasks = emptyList()
                        scheduled = false
                        toast("Đã xoá tất cả.")
                    }) { Text("Xoá tất cả") }
                }
            }

            Spacer(Modifier.height(8.dp))

            if (tasks.isNotEmpty() && !scheduled) {
                Button(
                    onClick = {
                        if (!controller.canScheduleExact()) {
                            openExactAlarmSettings(context)
                            toast("Hãy cấp quyền báo thức chính xác rồi bấm lại.")
                            return@Button
                        }
                        controller.scheduleAll(tasks)
                        scheduled = true
                        toast("Đã đặt ${tasks.size} báo thức.")
                    },
                    modifier = Modifier.fillMaxWidth()
                ) { Text("✅ Đặt báo thức tất cả (${tasks.size})") }
                Spacer(Modifier.height(8.dp))
            }

            if (scheduled && tasks.isNotEmpty()) {
                Text(
                    "Đã đặt báo thức — sẽ rung khi xong.",
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(Modifier.height(8.dp))
            }

            val now = controller.nowSec()
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(tasks, key = { it.id }) { task ->
                    TaskRow(task = task, nowSec = now, onDelete = {
                        controller.deleteOne(task)
                        tasks = tasks.filterNot { it.id == task.id }
                        if (tasks.isEmpty()) scheduled = false
                    })
                }
            }
        }
    }
}

@Composable
private fun TaskRow(task: BuilderTask, nowSec: Long, onDelete: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(task.label, fontWeight = FontWeight.SemiBold)
                Text(
                    "xong ${task.finishClock()} (còn ${task.remaining(nowSec)})",
                    style = MaterialTheme.typography.bodyMedium
                )
            }
            IconButton(onClick = onDelete) {
                Icon(Icons.Filled.Delete, contentDescription = "Xoá")
            }
        }
    }
}

private fun openExactAlarmSettings(context: android.content.Context) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val intent = Intent(
            Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
            Uri.parse("package:${context.packageName}")
        )
        context.startActivity(intent)
    }
}
