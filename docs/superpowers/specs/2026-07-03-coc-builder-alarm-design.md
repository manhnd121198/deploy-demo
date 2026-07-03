# CoC Builder Alarm — Design

**Date:** 2026-07-03
**Platform:** Android (Native Kotlin), chạy trên điện thoại thật.

## Mục tiêu

App Android nhận dữ liệu JSON "chia sẻ làng" của Clash of Clans, trích các timer đang chạy
(thợ xây, lab, thợ phụ, tháp đồng hồ, builder base), rồi đặt **báo thức chỉ rung** khi từng
việc hoàn thành.

## Kiến trúc

Một màn hình (single Activity). Luồng:

```
Dán JSON → [Parse] → Danh sách timer (loại + giờ xong) → [Đặt báo thức] → Rung khi xong
```

Thành phần:
- **JsonParser** — parse `timestamp` + mọi timer, tính `finishAt`.
- **AlarmScheduler** — đặt/huỷ `AlarmManager.setExactAndAllowWhileIdle` cho từng việc.
- **AlarmReceiver** — BroadcastReceiver, tới giờ bắn notification **chỉ rung** (no sound).
- **BootReceiver** — đặt lại alarm sau reboot.
- **Storage** — Room (hoặc SharedPreferences) lưu danh sách việc để BootReceiver khôi phục.

## Parse JSON

Duyệt `buildings`, `buildings2`, `units`, `units2`, `helpers`, và `boosts`:

| Nguồn | Field thời gian | Loại hiển thị |
|---|---|---|
| `buildings[]` có `timer` | `timer` | Thợ xây |
| `buildings2[]` có `timer` | `timer` | Builder Base |
| `units[]` / `units2[]` có `timer` | `timer` | Lab |
| `helpers[]` | `helper_cooldown` | Thợ phụ |
| `boosts.clocktower_cooldown` | giá trị | Tháp đồng hồ |

- `finishAt (epoch giây) = timestamp + timer`.
- Đánh số thứ tự trong từng nhóm (Thợ xây #1, #2…).
- **Bỏ qua** timer đã xong (`finishAt <= hiện tại`) — không đặt báo thức.
- Không tra tên công trình → chỉ hiển thị **loại + số thứ tự + giờ xong**.

Ví dụ dòng: `Thợ xây #3 — xong 18:34 (còn 2h19m)`.

## Đặt & bắn báo thức

- Mỗi việc = 1 alarm, `requestCode` riêng để đặt/huỷ độc lập.
- `setExactAndAllowWhileIdle(RTC_WAKEUP, finishAt, pendingIntent)` — kêu đúng giờ kể cả Doze.
- Android 12+: xin quyền `SCHEDULE_EXACT_ALARM` lần đầu (mở Settings nếu chưa cấp).
- AlarmReceiver: notification channel `IMPORTANCE_HIGH`, `setSound(null)`, **vibrate pattern**.
- BootReceiver (`RECEIVE_BOOT_COMPLETED`): đọc lại storage, đặt lại alarm còn hạn.

## Giao diện (1 màn hình)

- Ô nhập JSON lớn + nút **Parse & Xem trước**.
- Danh sách việc; mỗi dòng có **nút xoá riêng** (huỷ đúng alarm đó).
- Nút **Đặt báo thức tất cả**, nút **Xoá tất cả** (huỷ mọi alarm), nút **Đặt lại** (dán JSON mới).

## Build & cài

- macOS + Android SDK (command-line tools qua Homebrew, không bắt buộc mở Studio GUI).
- `./gradlew assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`.
- Cài: copy apk vào điện thoại, bấm cài trực tiếp (bật "cài từ nguồn không xác định").

## Xử lý lỗi

- JSON sai/thiếu field → báo "Dữ liệu không hợp lệ", không crash.
- Chưa cấp quyền exact alarm → nhắc + nút mở Settings.

## Test

- **JsonParser** (JUnit thuần): dùng JSON mẫu thật → đúng số lượng việc, `finishAt` đúng,
  bỏ timer đã xong.
- **Alarm**: test thủ công trên máy thật với timer ngắn (vài chục giây).

## Ngoài phạm vi (YAGNI)

- Không OCR ảnh (chỉ dán JSON).
- Không tra tên công trình cụ thể.
- Không phát âm thanh (chỉ rung).
- Không iOS.
