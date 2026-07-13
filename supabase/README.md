# Hướng deploy bằng Supabase

Hướng này chuyển phần lưu dữ liệu và job gửi tin từ Deno KV/Cron sang Supabase Postgres + Edge Functions.
Frontend vẫn có thể giữ ở `deploy-demo/public`, chỉ cần trỏ API sang Edge Function qua `config.js`.

## 1. Tạo bảng database

Mở Supabase SQL Editor rồi dán toàn bộ nội dung file `supabase/schema.sql` vào và chạy.

## 2. Deploy Edge Function

Cài/login Supabase CLI, sau đó link project:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Set secrets:

```bash
supabase secrets set AUTH_SECRET="$(openssl rand -hex 32)"
supabase secrets set ADMIN_TOKEN="$(openssl rand -hex 24)"
supabase secrets set DISPATCH_SECRET="$(openssl rand -hex 24)"
supabase secrets set PROJECT_URL="https://YOUR_PROJECT_REF.supabase.co"
supabase secrets set SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
```

Deploy function:

```bash
supabase functions deploy coc-builder-alarm --no-verify-jwt
```

URL của function sẽ có dạng:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/coc-builder-alarm
```

## 3. Cấu hình frontend

Copy file cấu hình mẫu:

```bash
cp deploy-demo/public/config.supabase.example.js deploy-demo/public/config.js
```

Sửa `deploy-demo/public/config.js`:

```js
window.COC_API_BASE = "https://YOUR_PROJECT_REF.supabase.co/functions/v1/coc-builder-alarm";
```

Sau đó deploy thư mục `deploy-demo/public` như một static site lên Netlify, Vercel, GitHub Pages hoặc bất kỳ static host nào.

## 4. Đặt lịch chạy job gửi tin

Supabase hỗ trợ gọi Edge Function theo lịch bằng Postgres Cron kết hợp `pg_net`.
Trong SQL Editor, bật extension:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
```

Đặt lịch gọi dispatcher mỗi phút:

```sql
select cron.schedule(
  'coc-builder-alarm-dispatch',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/coc-builder-alarm/dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Dispatch-Secret', 'YOUR_DISPATCH_SECRET'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Nếu muốn xoá lịch:

```sql
select cron.unschedule('coc-builder-alarm-dispatch');
```

## Ghi chú

- Edge Function dùng `SERVICE_ROLE_KEY`, vì vậy chỉ lưu key này trong Supabase secrets.
- `config.js` chỉ được chứa URL public của function, không được chứa service key.
- Các API path vẫn giữ nguyên: `/api/login`, `/api/account`, `/api/schedule`, `/api/tasks`, `/api/cancel`.
