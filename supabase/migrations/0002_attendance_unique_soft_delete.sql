-- Phase 1 amendment: UNIQUE on (emp_id, date, deleted_at) instead of (emp_id, date).
--
-- Why this has to change. Phase 5 pushes with upsert(), which conflicts on the
-- primary key `id`. But two devices marking the same Saathi on the same day
-- while offline mint two *different* UUIDs for one logical row, so the second
-- push collides with `unique (emp_id, date)` and fails outright - it does not
-- resolve as the "last-write-wins, one mark silently loses" the plan promised.
-- Soft deletes make it worse: a tombstone keeps occupying the (emp_id, date)
-- slot forever, so the day can never be marked again.
--
-- THE TRAP, and why this file is not a one-line ALTER.
--
-- A plain `unique (emp_id, date, deleted_at)` does NOT do what it looks like.
-- Postgres treats NULLs as distinct in a unique constraint by default, and
-- every live row has deleted_at = NULL - so two live marks for one Saathi on
-- one day would both be allowed and the one-mark-per-day invariant would be
-- silently gone. That is the opposite of the intent.
--
-- `NULLS NOT DISTINCT` (Postgres 15+) is what makes the three-column form
-- behave as intended:
--   * two live rows      -> both NULL, treated as equal  -> rejected
--   * live row + tombstone -> NULL vs a timestamp        -> allowed
--   * two tombstones     -> different timestamps         -> allowed
--
-- On Postgres 14 or older that syntax does not exist, so this falls back to a
-- partial unique index over live rows only, which enforces the same rule by a
-- different route. Read the NOTICE to see which branch ran.
--
-- Safe to re-run.

begin;

-- The original two-column constraint, named by Postgres convention in 0001.
alter table public.attendance
  drop constraint if exists attendance_emp_id_date_key;

-- Clear whichever form a previous run of this file left behind.
alter table public.attendance
  drop constraint if exists attendance_emp_date_live_key;
drop index if exists public.attendance_emp_date_live_key;

do $$
begin
  if current_setting('server_version_num')::int >= 150000 then
    execute 'alter table public.attendance
               add constraint attendance_emp_date_live_key
               unique nulls not distinct (emp_id, date, deleted_at)';
    raise notice 'OK - UNIQUE NULLS NOT DISTINCT (emp_id, date, deleted_at) added.';
  else
    execute 'create unique index attendance_emp_date_live_key
               on public.attendance (emp_id, date)
               where deleted_at is null';
    raise notice 'OK - Postgres %, below 15: used a partial unique index on live rows instead.',
      current_setting('server_version');
  end if;
end $$;

commit;

-- Verification: expect exactly one row, and no duplicate live marks.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.attendance'::regclass and contype = 'u'
union all
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and indexname = 'attendance_emp_date_live_key'
  and not exists (
    select 1 from pg_constraint
    where conrelid = 'public.attendance'::regclass
      and conname = 'attendance_emp_date_live_key'
  );

select emp_id, date, count(*) as live_rows,
       case when count(*) = 1 then 'OK' else 'FAIL - duplicate live marks' end as verdict
from public.attendance
where deleted_at is null
group by emp_id, date
having count(*) > 1;
