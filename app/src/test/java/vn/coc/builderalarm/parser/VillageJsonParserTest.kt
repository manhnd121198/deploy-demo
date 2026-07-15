package vn.coc.builderalarm.parser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VillageJsonParserTest {

    // JSON rút gọn từ dữ liệu làng thật, giữ đủ mọi loại timer.
    private val sampleJson = """
        {
          "timestamp": 1783064500,
          "buildings": [
            {"data":1000008,"lvl":10,"gear_up":1},
            {"data":1000009,"lvl":7,"timer":249},
            {"data":1000021,"lvl":0,"timer":8367},
            {"data":1000023,"lvl":0,"timer":1783}
          ],
          "buildings2": [
            {"data":1000034,"lvl":5,"timer":142875},
            {"data":1000033,"lvl":3,"cnt":100}
          ],
          "units": [
            {"data":4000004,"lvl":4},
            {"data":4000005,"lvl":4,"timer":59684}
          ],
          "helpers": [
            {"data":93000001,"lvl":1,"helper_cooldown":69379}
          ],
          "boosts": {"clocktower_cooldown":55111}
        }
    """.trimIndent()

    private val timestamp = 1783064500L

    @Test
    fun `trich dung so luong va phan loai timer`() {
        // now = timestamp -> mọi timer > 0 đều còn hạn.
        val tasks = VillageJsonParser.parse(sampleJson, timestamp)

        assertEquals(7, tasks.size)
        val byCat = tasks.groupingBy { it.category }.eachCount()
        assertEquals(3, byCat["Thợ xây"])       // 249, 8367, 1783
        assertEquals(1, byCat["Builder Base"])
        assertEquals(1, byCat["Lab"])
        assertEquals(1, byCat["Thợ phụ"])
        assertEquals(1, byCat["Tháp đồng hồ"])
    }

    @Test
    fun `so thu tu Tho xay dem rieng theo nhom`() {
        val tho = VillageJsonParser.parse(sampleJson, timestamp)
            .filter { it.category == "Thợ xây" }
            .map { it.label }
        assertTrue(tho.contains("Thợ xây #1"))
        assertTrue(tho.contains("Thợ xây #2"))
    }

    @Test
    fun `finishAt bang timestamp cong timer`() {
        val tasks = VillageJsonParser.parse(sampleJson, timestamp)
        // Timer nhỏ nhất là 249 -> finishAt sớm nhất.
        val earliest = tasks.minByOrNull { it.finishAtEpochSec }!!
        assertEquals(timestamp + 249, earliest.finishAtEpochSec)
    }

    @Test
    fun `nang cap tuong chiem tho xay dung loai lang`() {
        val json = """
            {
              "timestamp": $timestamp,
              "heroes": [{"data": 28000000, "lvl": 79, "timer": 3600}],
              "heroes2": [{"data": 28000001, "lvl": 34, "timer": 7200}]
            }
        """.trimIndent()

        val tasks = VillageJsonParser.parse(json, timestamp)

        assertEquals(1, tasks.count { it.category == "Thợ xây" })
        assertEquals(1, tasks.count { it.category == "Builder Base" })
    }

    @Test
    fun `tinh lai gio xong khi Tho xay Hoc viec dang giup`() {
        val json = """
            {
              "timestamp": $timestamp,
              "helpers": [{"data": 93000000, "lvl": 3, "helper_cooldown": 15990}],
              "buildings": [{"data": 1000013, "lvl": 5, "timer": 22215, "helper_timer": 3391}],
              "heroes": [{"data": 28000000, "lvl": 79, "timer": 3600, "helper_timer": 3600}]
            }
        """.trimIndent()

        val finishTimes = VillageJsonParser.parse(json, timestamp)
            .filter { it.category == "Thợ xây" }
            .map { it.finishAtEpochSec }

        assertTrue(finishTimes.contains(timestamp + 12042)) // 22215 - 3391 * 3
        assertTrue(finishTimes.contains(timestamp + 900)) // xong khi trợ thủ vẫn đang hoạt động
    }

    @Test
    fun `hien ten va cap nang cap khi catalog co data id`() {
        val names = mapOf(
            1000009L to "Tháp Cung",
            4000005L to "Khinh khí cầu"
        )

        val tasks = VillageJsonParser.parse(sampleJson, timestamp, names::get)

        assertTrue(tasks.any { it.label == "Tháp Cung 8" })
        assertTrue(tasks.any { it.label == "Khinh khí cầu 5" })
    }

    @Test
    fun `giu nhan cu khi catalog khong co data id`() {
        val tasks = VillageJsonParser.parse(sampleJson, timestamp) { null }

        assertTrue(tasks.any { it.label.startsWith("Thợ xây #") })
        assertTrue(tasks.any { it.label.startsWith("Lab #") })
    }

    @Test
    fun `bo qua timer da xong`() {
        // now = timestamp + 2000 -> các timer <= 2000 (249, 1783) đã xong.
        val tasks = VillageJsonParser.parse(sampleJson, timestamp + 2000)
        val thoCount = tasks.count { it.category == "Thợ xây" }
        assertEquals(1, thoCount) // chỉ còn timer 8367
    }

    @Test(expected = VillageParseException::class)
    fun `json sai nem VillageParseException`() {
        VillageJsonParser.parse("{ khong-phai-json", 0)
    }

    @Test(expected = VillageParseException::class)
    fun `thieu timestamp nem exception`() {
        VillageJsonParser.parse("""{"buildings":[]}""", 0)
    }
}
