-- =====================================================================
-- KBS FP&A Dashboard — Supabase schema (SECURED with login)
-- Run this once: Supabase -> SQL Editor -> New query -> paste -> Run
--
-- Every table is locked to logged-in users only. Nobody can read the
-- actuals, forecast, or comments without a valid account that YOU create.
-- =====================================================================

-- 1) ACTUALS - the Jan-May line-item data (moved out of the front-end)
create table if not exists public.actuals (
  id          text primary key,
  label       text not null,
  cat         text not null,
  vendor      text not null,
  sort_order  int  not null default 0,
  jan numeric not null default 0,
  feb numeric not null default 0,
  mar numeric not null default 0,
  apr numeric not null default 0,
  may numeric not null default 0
);

-- 2) FORECAST - one row per reviewer; the editable grid as JSON
create table if not exists public.forecast (
  reviewer   text primary key,
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- 3) COMMENTS - one row per comment, keyed to a cell
create table if not exists public.comments (
  id          bigint generated always as identity primary key,
  cell_key    text not null,
  author      text not null,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists comments_cell_key_idx on public.comments (cell_key);

-- 4) REQUISITIONS - open reqs Ben adds on the org chart; flow into the forecast
create table if not exists public.requisitions (
  id          bigint generated always as identity primary key,
  title       text not null,
  reports_to  text,                        -- manager/team this req sits under
  salary_low  numeric not null default 0,
  salary_high numeric not null default 0,
  bonus_pct   numeric not null default 0,  -- e.g. 10 for 10%
  start_date  date,                        -- target start
  created_at  timestamptz not null default now()
);

-- =====================================================================
-- ROW LEVEL SECURITY - authenticated users only
-- =====================================================================
alter table public.actuals  enable row level security;
alter table public.forecast enable row level security;
alter table public.comments enable row level security;
alter table public.requisitions enable row level security;

drop policy if exists "actuals read" on public.actuals;
create policy "actuals read" on public.actuals
  for select to authenticated using (true);

drop policy if exists "forecast read"   on public.forecast;
drop policy if exists "forecast insert" on public.forecast;
drop policy if exists "forecast update" on public.forecast;
create policy "forecast read"   on public.forecast for select to authenticated using (true);
create policy "forecast insert" on public.forecast for insert to authenticated with check (true);
create policy "forecast update" on public.forecast for update to authenticated using (true) with check (true);

drop policy if exists "comments read"   on public.comments;
drop policy if exists "comments insert" on public.comments;
drop policy if exists "comments delete" on public.comments;
create policy "comments read"   on public.comments for select to authenticated using (true);
create policy "comments insert" on public.comments for insert to authenticated with check (true);
create policy "comments delete" on public.comments for delete to authenticated using (true);

-- REQUISITIONS - logged-in users read + add + delete
drop policy if exists "reqs read"   on public.requisitions;
drop policy if exists "reqs insert" on public.requisitions;
drop policy if exists "reqs delete" on public.requisitions;
create policy "reqs read"   on public.requisitions for select to authenticated using (true);
create policy "reqs insert" on public.requisitions for insert to authenticated with check (true);
create policy "reqs delete" on public.requisitions for delete to authenticated using (true);

-- =====================================================================
-- SEED THE ACTUALS (Jan-May 2026, from the May close)
-- =====================================================================
insert into public.actuals (id,label,cat,vendor,sort_order,jan,feb,mar,apr,may) values
 ('salary',   'Salary',                                 'payroll', 'Employees',                        1, 88421,93957,89857,86315,86361),
 ('benefits', 'Employee Benefits',                      'benefits','Employees',                        2,  9441, 7543, 7348, 6885, 7068),
 ('anthem',   '60100 - Employee Benefits',              'benefits','Anthem Blue Cross (KBS)',          3,  4422, 4422, 4422, 5280, 5214),
 ('ccsi',     '60203 - Service Center Expenses',        'service', 'Call Center Services Intl (KBS)',  4, 13043,16095,18759,14580,20651),
 ('accordion','61005 - Prof Fees - Accounting & Audit', 'prof',    'Accordion Partners (KBS)',         5,     0,  600,    0,    0,    0),
 ('shankly',  '61005 - Prof Fees - Accounting & Audit', 'prof',    'Shankly Advisory Partners (KBS)',  6,  5600,    0,    0,    0,    0),
 ('travel',   '60301 - Travel',                         'te',      'Employees',                        7,  1234,    0,  366,    0,    0),
 ('mileage_e','60302 - Mileage Reimbursement',          'te',      'Employees',                        8,   548,    0,  151,    0,    0),
 ('mileage_m','60302 - Mileage Reimbursement',          'te',      'Motus Reimbursement (KBS)',        9,   700,    0,    0,    0,    0),
 ('meals',    '60303 - Meals / Ent',                    'te',      'Employees',                       10,     0,  549,   41,    0,    0),
 ('parking',  '60304 - Parking Expense',                'te',      'Employees',                       11,     0,   85,    0,    0,    0),
 ('fed_unemp','55013 - Direct Labor - Fed Unemployment','other',   'Employees',                       12,    51,   51,   51,   51,   51),
 ('hourly',   '60002 - Hourly',                         'other',   'Employees',                       13,  5734, 5120,-1280,    0,    0),
 ('overtime', '60003 - Overtime',                       'other',   'Employees',                       14,   453,  752, -187,    0,    0),
 ('bonus',    '60006 - Indirect - Bonus',               'other',   'Employees',                       15,     0,  600, -200,    0,    0),
 ('vacation', '60009 - Indirect - Vacation',            'other',   'Employees',                       16,  -158, -138,    0,    0,    0),
 ('supplies', '60503 - Office Supplies',                'other',   'Other',                           17,     0,    0,    0,    0,  100)
on conflict (id) do update set
  label=excluded.label, cat=excluded.cat, vendor=excluded.vendor, sort_order=excluded.sort_order,
  jan=excluded.jan, feb=excluded.feb, mar=excluded.mar, apr=excluded.apr, may=excluded.may;

insert into public.forecast (reviewer, data) values ('ben','{}')
on conflict (reviewer) do nothing;

-- =====================================================================
-- CREATE THE THREE ACCOUNTS
-- Easiest: Supabase Dashboard -> Authentication -> Users -> "Add user"
--   (set email + password, tick "Auto Confirm User"). Do this 3 times.
--
-- Or run this block to create them via SQL. REPLACE THE PASSWORDS FIRST.
-- =====================================================================
do $$
declare
  users jsonb := '[
    {"email":"ben@kbs-services.com",   "pw":"CHANGE_ME_BEN"},
    {"email":"jae@kbs-services.com",   "pw":"CHANGE_ME_JAE"},
    {"email":"hayden@kbs-services.com","pw":"CHANGE_ME_YOU"}
  ]';
  u jsonb;
begin
  for u in select * from jsonb_array_elements(users)
  loop
    if not exists (select 1 from auth.users where email = (u->>'email')) then
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data
      ) values (
        '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated','authenticated',
        u->>'email', crypt(u->>'pw', gen_salt('bf')),
        now(), now(), now(),
        '{"provider":"email","providers":["email"]}', '{}'
      );
    end if;
  end loop;
end $$;
