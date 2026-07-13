create table if not exists public.accounts (
  name text primary key,
  salt text not null,
  hash text not null,
  channel text not null default 'google' check (channel in ('google', 'telegram')),
  webhook_url text not null default '',
  telegram_bot_token text not null default '',
  telegram_chat_id text not null default '',
  json_data text not null default '',
  created_at bigint not null
);

create table if not exists public.tasks (
  key text primary key,
  name text not null references public.accounts(name) on delete cascade,
  label text not null,
  finish_at bigint not null,
  text text not null,
  channel text not null default 'google' check (channel in ('google', 'telegram')),
  webhook_url text not null default '',
  telegram_bot_token text not null default '',
  telegram_chat_id text not null default '',
  attempts integer not null default 0,
  created_at bigint not null default extract(epoch from now())::bigint
);

create index if not exists tasks_name_idx on public.tasks (name, finish_at);
create index if not exists tasks_due_idx on public.tasks (finish_at, attempts);

alter table public.accounts enable row level security;
alter table public.tasks enable row level security;
