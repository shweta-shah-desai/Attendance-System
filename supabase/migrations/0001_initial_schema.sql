-- GharSaathi+ cloud schema — Phase 1 of convert_app_to_online_with data_storage.md
--
-- Mirrors src/db/schema.ts, with four deliberate differences:
--   * uuid primary keys instead of INTEGER AUTOINCREMENT (client-generated; Phase 2)
--   * `profiles` replaces `users` — Supabase owns identity in auth.users
--   * owner_id denormalised onto every row so RLS policies need no joins
--   * deleted_at soft deletes — a hard DELETE is invisible to a pull-based sync,
--     so other devices would resurrect the row
--
-- `holidays` is intentionally not synced: schema.ts:60 defines it but no UI writes
-- to it. Add it when a holidays screen ships.
--
-- Safe to re-run: every object is guarded.

begin;

-- ---------------------------------------------------------------- 1. tables

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  name         text not null,
  phone        text not null,
  email_id     text,
  resi_address text,
  status       text not null default 'active' check (status in ('active','inactive')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.employees (
  id           uuid primary key,              -- client-generated, see Phase 2
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  name         text not null,
  phone        text,
  resi_address text,
  status       text not null default 'active' check (status in ('active','inactive')),
  remarks      text,
  start_date   date,
  end_date     date,
  wage_type    text not null check (wage_type in ('Monthly','Rokadi','Bi-weekly')),
  wage_amt     integer not null check (wage_amt > 0),
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists employees_owner_updated_idx
  on public.employees (owner_id, updated_at);

create table if not exists public.attendance (
  id          uuid primary key,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  emp_id      uuid not null references public.employees(id) on delete cascade,
  date        date not null,
  time_in     text,
  time_out    text,
  status      text not null check (status in
                ('Present','Absent','Half-day','WFH','Leave','Holiday','Weekend')),
  remarks     text,
  entry_type  text not null default 'manual' check (entry_type in ('manual','admin-entered')),
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (emp_id, date)                       -- matches schema.ts:57
);
create index if not exists attendance_owner_updated_idx
  on public.attendance (owner_id, updated_at);

-- per-user key/value, mirrors DEFAULT_SETTINGS (schema.ts:102)
create table if not exists public.settings (
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  key        text not null,
  value      text,
  updated_at timestamptz not null default now(),
  primary key (owner_id, key)
);

-- ------------------------------------------------- 2. updated_at maintenance
-- The sync cursor depends on updated_at being truthful, so a client must not
-- be able to set it. BEFORE UPDATE overwrites whatever the client sent.

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_profiles_touch   on public.profiles;
drop trigger if exists trg_employees_touch  on public.employees;
drop trigger if exists trg_attendance_touch on public.attendance;
drop trigger if exists trg_settings_touch   on public.settings;

create trigger trg_profiles_touch   before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger trg_employees_touch  before update on public.employees
  for each row execute function public.touch_updated_at();
create trigger trg_attendance_touch before update on public.attendance
  for each row execute function public.touch_updated_at();
create trigger trg_settings_touch   before update on public.settings
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------ 3. Row Level Security
-- The anon key ships inside the APK and anyone can extract it. RLS is the only
-- thing standing between one household's register and another's. Not optional.

alter table public.profiles   enable row level security;
alter table public.employees  enable row level security;
alter table public.attendance enable row level security;
alter table public.settings   enable row level security;

drop policy if exists profiles_select  on public.profiles;
drop policy if exists profiles_insert  on public.profiles;
drop policy if exists profiles_update  on public.profiles;
drop policy if exists employees_all    on public.employees;
drop policy if exists attendance_all   on public.attendance;
drop policy if exists settings_all     on public.settings;

-- profiles: you see and edit only your own row
create policy profiles_select on public.profiles
  for select using (id = auth.uid());
create policy profiles_insert on public.profiles
  for insert with check (id = auth.uid());
create policy profiles_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- employees / attendance / settings: scoped by owner_id.
-- The with-check on insert/update is what stops a client writing rows
-- stamped with somebody else's owner_id.
create policy employees_all on public.employees
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy attendance_all on public.attendance
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy settings_all on public.settings
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ------------------------------------------------------------ 3b. privileges
-- RLS filters rows, but it only runs *after* Postgres has checked table-level
-- privileges - so without these GRANTs every query fails with
-- "permission denied for table" (42501) no matter how correct the policies
-- are. Supabase's default privileges already grant them on this project;
-- these statements are stated explicitly so the schema does not depend on a
-- platform default staying true, and are a no-op where it holds.
--
-- `authenticated` only. `anon` is deliberately given nothing: an anonymous
-- caller has no auth.uid(), so every policy above would match zero rows
-- anyway, and no GRANT is a tighter answer than an empty result. Signup and
-- login do not touch these tables - they go through the auth endpoints, and
-- the profile row is created by the security-definer trigger below.

grant usage on schema public to authenticated;
grant select, insert, update, delete
  on public.profiles, public.employees, public.attendance, public.settings
  to authenticated;

-- ------------------------------------------------- 4. profile auto-creation
-- Creates the profile row at signup so the client never races between
-- "account exists" and "profile exists". The client passes name/phone in
-- options.data at signup, which is where raw_user_meta_data comes from.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', 'Saathi user'),
    coalesce(new.phone, new.raw_user_meta_data->>'phone', '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

commit;
