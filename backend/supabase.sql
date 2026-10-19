-- Run once in Supabase SQL Editor. All user-owned rows are protected by RLS.
create extension if not exists pgcrypto;

create table if not exists public.courses (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  course_name text not null,
  teacher text not null default '',
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time,
  start_week smallint not null default 1,
  end_week smallint not null default 16,
  location text not null default '',
  class_name text not null default '',
  note text not null default '',
  semester text not null default '',
  color text not null default '#6675e8',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.todos (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  due_at timestamptz,
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  source text not null default 'manual',
  source_detail text not null default '',
  status text not null default 'open' check (status in ('open','completed')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.drafts (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  due_at timestamptz,
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  source text not null default 'message import',
  source_detail text not null default '',
  confidence numeric(4,3) not null default 0 check (confidence between 0 and 1),
  status text not null default 'pending' check (status in ('pending','rejected','approved')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reminders (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  todo_id text not null,
  fire_at timestamptz not null,
  notification_id text,
  device_id text not null default '',
  sound boolean not null default true,
  triggered_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled','sent','cancelled')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.reminders add column if not exists sound boolean not null default true;

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.courses enable row level security;
alter table public.todos enable row level security;
alter table public.drafts enable row level security;
alter table public.reminders enable row level security;
alter table public.user_settings enable row level security;

do $$ declare t text; begin
  foreach t in array array['courses','todos','drafts','reminders'] loop
    execute format('drop policy if exists "users manage own %1$s" on public.%1$I', t);
    execute format('create policy "users manage own %1$s" on public.%1$I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;
drop policy if exists "users manage own settings" on public.user_settings;
create policy "users manage own settings" on public.user_settings for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Enable cross-device refresh for authenticated clients using Supabase Realtime.
do $$ declare t text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['courses','todos','drafts','reminders','user_settings'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null;
      end;
    end loop;
  end if;
end $$;

create index if not exists courses_user_weekday_idx on public.courses(user_id, weekday) where deleted_at is null;
create index if not exists todos_user_due_idx on public.todos(user_id, due_at) where deleted_at is null;
create index if not exists reminders_user_fire_idx on public.reminders(user_id, fire_at) where deleted_at is null;
