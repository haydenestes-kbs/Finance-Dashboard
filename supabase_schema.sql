-- =====================================================================
-- KBS FP&A Dashboard — Supabase schema
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run
-- =====================================================================

-- 1) FORECAST  — one row per reviewer; stores the whole editable grid as JSON
create table if not exists public.forecast (
  reviewer   text primary key,            -- e.g. 'ben'
  data       jsonb not null default '{}', -- { lineId: [12 monthly values], ... }
  updated_at timestamptz not null default now()
);

-- 2) COMMENTS — one row per comment, keyed to a specific cell
create table if not exists public.comments (
  id          bigint generated always as identity primary key,
  cell_key    text not null,              -- "forecast|<lineId>|<monthIdx>"
  author      text not null,              -- e.g. 'Ben Fremont'
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists comments_cell_key_idx on public.comments (cell_key);

-- =====================================================================
-- ROW LEVEL SECURITY
-- This dashboard is an internal tool shared via a single anon key.
-- The policies below allow read+write with the anon key (no per-user login).
-- If you later add Supabase Auth, tighten these to authenticated users.
-- =====================================================================
alter table public.forecast enable row level security;
alter table public.comments enable row level security;

-- FORECAST policies
drop policy if exists "forecast read"  on public.forecast;
drop policy if exists "forecast write" on public.forecast;
create policy "forecast read"  on public.forecast for select using (true);
create policy "forecast write" on public.forecast for insert with check (true);
create policy "forecast update" on public.forecast for update using (true) with check (true);

-- COMMENTS policies
drop policy if exists "comments read"   on public.comments;
drop policy if exists "comments insert" on public.comments;
drop policy if exists "comments delete" on public.comments;
create policy "comments read"   on public.comments for select using (true);
create policy "comments insert" on public.comments for insert with check (true);
create policy "comments delete" on public.comments for delete using (true);

-- =====================================================================
-- OPTIONAL: seed an empty forecast row for Ben (the app upserts anyway)
-- =====================================================================
insert into public.forecast (reviewer, data)
values ('ben', '{}')
on conflict (reviewer) do nothing;
