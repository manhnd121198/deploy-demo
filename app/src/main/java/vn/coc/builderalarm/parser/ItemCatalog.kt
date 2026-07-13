package vn.coc.builderalarm.parser

import android.content.Context
import org.json.JSONObject

/** Tra tên hiển thị của item CoC theo field `data` trong JSON làng. */
class ItemCatalog(context: Context) {

    private val names: Map<Long, String> = context.applicationContext.assets
        .open("catalog.json")
        .bufferedReader()
        .use { reader ->
            val items = JSONObject(reader.readText()).getJSONObject("items")
            items.keys().asSequence().associate { id ->
                val item = items.getJSONObject(id)
                id.toLong() to item.optString("nameVi").ifBlank { item.optString("name") }
            }
        }

    fun nameOf(dataId: Long): String? = names[dataId]?.takeIf { it.isNotBlank() }
}
