# CoC Builder Alarm — Web (Cloudflare Workers) Deploy Guide

Bản web thay cho app Android: dán JSON làng → Worker hẹn giờ → gửi tin Google Chat khi mỗi
việc xong. **Chạy trên Cloudflare, không cần mở máy.**

Mã nguồn: `web/` (UI tĩnh `public/`, Worker `src/worker.js`).

## Kiến trúc

```
Trình duyệt (public/)          Cloudflare Worker (src/worker.js)
─ parse JSON (parser.js)   ──▶  POST /api/schedule  → lưu vào KV
─ xem/huỷ lịch             ◀──  GET  /api/tasks / POST /api/cancel
                                cron mỗi phút → gửi Google Chat khi finishAt tới hạn
```

- Parse chạy ở client (khớp `VillageJsonParser.kt`); server chỉ lưu + hẹn giờ + gửi.
- Sai số bắn tin: **±1 phút** (giới hạn cron nhỏ nhất của Cloudflare) — đủ cho báo thức thợ xây.
- Webhook URL lưu trong KV phía server, **không** trả về API `/api/tasks`.

## Đăng nhập & tài khoản

- Mỗi **tài khoản = tên + PIN** tự tạo ngay trên trang. Data (webhook + danh sách lịch) tách
  riêng theo tài khoản; key KV `task:<tên>:<uuid>`.
- Một người quản nhiều làng → tạo nhiều tài khoản (vd `lang-chinh`, `lang-phu`). Người khác
  tạo tài khoản của họ, không thấy data của nhau.
- PIN lưu dạng **PBKDF2-SHA256 + salt**; phiên giữ bằng **token ký HMAC** (secret `AUTH_SECRET`).

## Deploy (1 lần)

Cần: Node.js + tài khoản Cloudflare (miễn phí, không cần thẻ).

```bash
cd web
npm install

# 1) Đăng nhập Cloudflare
npx wrangler login

# 2) Tạo KV namespace, copy "id" in ra
npx wrangler kv namespace create TASKS
#   -> dán id vào wrangler.toml, thay REPLACE_WITH_KV_NAMESPACE_ID

# 3) Đặt secret ký token (gõ 1 chuỗi ngẫu nhiên dài khi được hỏi)
npx wrangler secret put AUTH_SECRET
#   gợi ý sinh chuỗi: openssl rand -base64 32

# 4) Deploy
npx wrangler deploy
```

Sau khi deploy, Wrangler in ra URL dạng `https://coc-builder-alarm.<subdomain>.workers.dev`.
Mở URL đó → **Tạo tài khoản mới** (tên + PIN) → dán webhook + JSON làng → **Parse** →
**Đặt gửi Chat tất cả**. Xong, tắt máy được.

## Chạy thử local

Tạo file `web/.dev.vars` (đã gitignore) chứa secret cho local:

```
AUTH_SECRET = "chuoi-ngau-nhien-tuy-y"
```

```bash
cd web
npx wrangler dev          # phục vụ UI + API tại http://localhost:8787
```

Cron không tự chạy trong `dev`; để test bắn tin, gọi tay:

```bash
curl "http://localhost:8787/cdn-cgi/handler/scheduled"   # kích hoạt scheduled() thủ công
```

## Lấy Google Chat webhook URL

Trong Google Chat → mở Space → **Apps & integrations** → **Webhooks** → **Add webhook** →
copy URL dạng `https://chat.googleapis.com/v1/spaces/.../messages?key=...`.

## Giới hạn free tier (đủ dùng cá nhân)

- Workers: 100k request/ngày. Cron mỗi phút = ~1.440 lần/ngày.
- KV: 100k đọc, 1k ghi/ngày.
- Không giới hạn thời gian; chạy kể cả khi máy bạn tắt.

## Lưu ý bảo mật

- Có đăng nhập tên + PIN; data tách riêng theo tài khoản. PIN chỉ nên coi là khoá nhẹ —
  không đặt PIN trùng mật khẩu quan trọng.
- `/api/register` mở cho mọi người (ai vào URL cũng tạo được tài khoản). Nếu muốn giới hạn,
  chặn hoặc thêm mã mời ở `register`.
- Không có rate-limit thử PIN (YAGNI). Nếu lo brute-force, thêm giới hạn ở `login`.

## Unresolved questions

- Có cần chặn tự đăng ký (mã mời) và rate-limit đăng nhập không? Hiện để mở cho đơn giản.
