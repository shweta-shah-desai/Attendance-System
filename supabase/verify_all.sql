-- GharSaathi+ : one-shot cloud verification.  Paste the whole file into the
-- Supabase SQL editor and Run once.  It returns ONE result grid; every row
-- should read OK (or -- for a check that could not apply).
--
-- Why this exists alongside 0001_verify.sql: that one emits six separate
-- result grids plus two NOTICEs, and the SQL editor shows only the last grid,
-- so it has to be run a block at a time.  This collects those six checks,
-- the 0002 constraint, and an RLS isolation test into a single verdict table.
--
-- Checks 1-8 are read-only.  Checks 9-11 must write, so they create one
-- throwaway employees row (name '__verify__') owned by the oldest existing
-- profile and delete it again; every block has an EXCEPTION handler that
-- resets the role and clears the row, so a failure cannot leave debris or a
-- stuck impersonation.  Nothing else is touched.  Safe to re-run.

begin;

create temp table _v (
  id         int,
  check_name text,
  detail     text,
  verdict    text
) on commit drop;

-- ---------------------------------------------------------------- 1. RLS on
insert into _v
select 1, 'RLS enabled', tablename,
       case when rowsecurity then 'OK' else 'FAIL - RLS OFF' end
from pg_tables
where schemaname = 'public'
  and tablename in ('profiles','employees','attendance','settings');

insert into _v
select 1, 'RLS enabled', 'table count',
       case when count(*) = 4 then 'OK'
            else 'FAIL - expected 4 tables, found ' || count(*) || ' (is 0001 run?)' end
from pg_tables
where schemaname = 'public'
  and tablename in ('profiles','employees','attendance','settings');

-- ------------------------------------------------------------- 2. policies
-- Driven from the expected table list, not from pg_policies.  A `group by` over
-- pg_policies alone emits no row for a table whose policies were all dropped,
-- so the very failure worth catching would be reported as silence.
insert into _v
select 2, 'Policies present',
       t.tablename || ' (' || coalesce(p.n, 0) || ' of ' || t.want || ')',
       case when coalesce(p.n, 0) = t.want then 'OK'
            when coalesce(p.n, 0) = 0 then 'FAIL - no policies at all; table is unprotected'
            else 'FAIL - expected ' || t.want || ' policies, found ' || p.n end
from (values ('profiles', 3), ('employees', 1), ('attendance', 1), ('settings', 1))
       as t(tablename, want)
left join (
  select tablename, count(*)::int as n from pg_policies
  where schemaname = 'public' group by tablename
) p on p.tablename = t.tablename;

-- -------------------------------------------------- 3. updated_at triggers
-- Driven from the expected table list, for the same reason as check 2.
insert into _v
select 3, 'updated_at trigger', t.tablename,
       case when coalesce(g.n, 0) = 1 then 'OK'
            when coalesce(g.n, 0) = 0 then 'FAIL - missing; updated_at is client-controlled'
            else 'FAIL - ' || g.n || ' touch triggers, expected 1' end
from (values ('profiles'), ('employees'), ('attendance'), ('settings'))
       as t(tablename)
left join (
  select c.relname, count(*)::int as n
  from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where not tg.tgisinternal and tg.tgname like 'trg%touch' and n.nspname = 'public'
  group by c.relname
) g on g.relname = t.tablename;

-- --------------------------------------------------------- 4. signup trigger
insert into _v
select 4, 'Signup trigger', 'on_auth_user_created',
       case when count(*) = 1 then 'OK' else 'FAIL - missing' end
from pg_trigger
where tgname = 'on_auth_user_created' and not tgisinternal;

-- ------------------------------------------ 5. authenticated role can reach
-- Driven from the expected table list: a table with NO grant at all must be
-- reported, and a `group by` over role_table_grants would omit it entirely.
insert into _v
select 5, 'Grants: authenticated', t.tablename || ' (' || coalesce(g.granted, 'none') || ')',
       case when coalesce(g.n, 0) = 4 then 'OK'
            else 'FAIL - missing one of SELECT/INSERT/UPDATE/DELETE' end
from (values ('profiles'), ('employees'), ('attendance'), ('settings'))
       as t(tablename)
left join (
  select table_name,
         count(*) filter (
           where privilege_type in ('SELECT','INSERT','UPDATE','DELETE')) ::int as n,
         string_agg(privilege_type, ',' order by privilege_type) filter (
           where privilege_type in ('SELECT','INSERT','UPDATE','DELETE')) as granted
  from information_schema.role_table_grants
  where grantee = 'authenticated' and table_schema = 'public'
  group by table_name
) g on g.table_name = t.tablename;

-- ----------------------------------------- 6. anon must reach nothing (A3)
-- The anon key ships inside the APK.  It should hold no table privileges at
-- all; RLS would return zero rows anyway, but no GRANT is the tighter answer.
insert into _v
select 6, 'Grants: anon revoked',
       coalesce(string_agg(distinct table_name, ', '), 'none'),
       case when count(*) = 0 then 'OK'
            else 'FAIL - anon holds privileges it should not' end
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public'
  and table_name in ('profiles','employees','attendance','settings')
  and privilege_type in ('SELECT','INSERT','UPDATE','DELETE');

-- -------------------------------------- 7. the 0002 live-unique constraint
-- Either form counts: the PG15+ constraint or the PG14 partial index.
insert into _v
select 7, '0002 live-unique applied',
       coalesce(
         (select pg_get_constraintdef(oid) from pg_constraint
           where conrelid = 'public.attendance'::regclass
             and conname  = 'attendance_emp_date_live_key'),
         (select indexdef from pg_indexes
           where schemaname = 'public'
             and indexname  = 'attendance_emp_date_live_key'),
         'not found'),
       case when exists (
              select 1 from pg_constraint
               where conrelid = 'public.attendance'::regclass
                 and conname  = 'attendance_emp_date_live_key')
            or exists (
              select 1 from pg_indexes
               where schemaname = 'public'
                 and indexname  = 'attendance_emp_date_live_key')
       then 'OK' else 'FAIL - run 0002, a deleted day can never be re-marked' end;

-- The old two-column constraint must be gone, or offline re-marks still fail.
insert into _v
select 7, '0002 old constraint dropped', 'attendance_emp_id_date_key',
       case when not exists (
              select 1 from pg_constraint
               where conrelid = 'public.attendance'::regclass
                 and conname  = 'attendance_emp_id_date_key')
       then 'OK' else 'FAIL - old unique (emp_id,date) still there; run 0002' end;

-- -------------------------------------------- 8. no duplicate live marks
-- If this fails, 0002 cannot be applied until the duplicates are resolved.
insert into _v
select 8, 'No duplicate live marks',
       case when count(*) = 0 then 'none'
            else count(*) || ' (emp_id,date) pairs duplicated' end,
       case when count(*) = 0 then 'OK' else 'FAIL - resolve before 0002' end
from (
  select emp_id, date from public.attendance
  where deleted_at is null
  group by emp_id, date having count(*) > 1
) d;

-- ============================================================================
-- 9-11.  Write-dependent checks.
--
-- Split into three blocks on purpose.  A single block wrapped in one EXCEPTION
-- handler is one subtransaction, so an error in the last check would roll back
-- the verdict rows the earlier ones had already written.  Separate blocks keep
-- whatever passed.
-- ============================================================================

-- ---- A. seed the throwaway row, and check updated_at cannot be forged -----
do $block$
declare
  v_owner  uuid;
  v_emp    uuid;
  v_before timestamptz;
  v_after  timestamptz;
begin
  select id into v_owner from public.profiles order by created_at limit 1;
  if v_owner is null then
    insert into _v values
      (9,  'RLS isolation',           'no profiles yet', 'SKIPPED - sign up once, then re-run'),
      (10, 'Forged owner_id insert',  'no profiles yet', 'SKIPPED - sign up once, then re-run'),
      (11, 'updated_at not forgeable','no profiles yet', 'SKIPPED - sign up once, then re-run');
    return;
  end if;

  select gen_random_uuid() into v_emp;
  insert into public.employees (id, owner_id, name, wage_type, wage_amt)
    values (v_emp, v_owner, '__verify__', 'Monthly', 1);

  select updated_at into v_before from public.employees where id = v_emp;
  update public.employees
     set name = '__verify2__', updated_at = '2000-01-01'::timestamptz
   where id = v_emp;
  select updated_at into v_after from public.employees where id = v_emp;

  -- Assert the forged value did not survive -- NOT that updated_at advanced.
  -- now() is the transaction timestamp, so the insert and this update stamp
  -- the identical value and `v_after > v_before` is false however well the
  -- trigger works.  Whether the client's '2000-01-01' stuck is the real test.
  insert into _v values (11, 'updated_at not forgeable', 'BEFORE UPDATE trigger',
    case when v_after = '2000-01-01'::timestamptz
              then 'FAIL - client was able to set updated_at'
         when v_after < v_before
              then 'FAIL - updated_at moved backwards'
         else 'OK' end);

exception when others then
  delete from public.employees where name in ('__verify__','__verify2__');
  insert into _v values (11, 'updated_at not forgeable', sqlstate || ': ' || sqlerrm,
    'ERROR - check aborted, throwaway row cleaned up');
end $block$;

-- ---- B. isolation and owner_id spoofing, under impersonation -------------
-- auth.uid() reads the `sub` JWT claim, so impersonating a stranger needs no
-- auth.users row.  That is what lets this stand in for the two-device test.
--
-- Every count goes into a variable while the role is `authenticated`, and the
-- verdicts are written only after `reset role`: the temp table is owned by
-- postgres and `authenticated` has no grant on it, so inserting into _v
-- mid-impersonation would fail with 42501 and look like a broken check.
do $block$
declare
  v_owner   uuid;
  v_other   uuid;
  v_tot_emp int; v_tot_att int; v_tot_pro int;
  v_see_emp int; v_see_att int; v_see_pro int;
  v_forge   text;
begin
  select id into v_owner from public.profiles order by created_at limit 1;
  if v_owner is null then return; end if;   -- block A already reported SKIPPED
  select id into v_other from public.profiles
    where id <> v_owner order by created_at limit 1;

  -- Totals as postgres (RLS does not apply to the table owner), so the
  -- verdict can say "0 of N visible" instead of a meaningless bare 0.
  select count(*) into v_tot_emp from public.employees;
  select count(*) into v_tot_att from public.attendance;
  select count(*) into v_tot_pro from public.profiles;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);

  select count(*) into v_see_emp from public.employees;
  select count(*) into v_see_att from public.attendance;
  select count(*) into v_see_pro from public.profiles;

  -- Now as the real owner, try to write a row stamped with someone else's id.
  -- One account is enough to make this conclusive: Postgres evaluates the
  -- policy WITH CHECK during the insert and validates foreign keys only after,
  -- so RLS rejects the forged owner_id before the FK is ever consulted.  A
  -- second real profile is still preferred where one exists.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  begin
    insert into public.employees (id, owner_id, name, wage_type, wage_amt)
      values (gen_random_uuid(), coalesce(v_other, gen_random_uuid()),
              '__verify_forged__', 'Monthly', 1);
    v_forge := 'ACCEPTED';
  exception
    when insufficient_privilege then v_forge := 'RLS';
    when foreign_key_violation then v_forge := 'FK';
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
  delete from public.employees where name = '__verify_forged__';  -- if it got in

  insert into _v values (9, 'RLS isolation',
    'employees: ' || v_see_emp || ' visible of ' || v_tot_emp || ' total',
    case when v_tot_emp = 0 then 'SKIPPED - no rows to hide'
         when v_see_emp = 0 then 'OK'
         else 'FAIL - cross-account leak' end);

  insert into _v values (9, 'RLS isolation',
    'attendance: ' || v_see_att || ' visible of ' || v_tot_att || ' total',
    case when v_tot_att = 0 then 'SKIPPED - no rows to hide'
         when v_see_att = 0 then 'OK'
         else 'FAIL - cross-account leak' end);

  insert into _v values (9, 'RLS isolation',
    'profiles: ' || v_see_pro || ' visible of ' || v_tot_pro || ' total',
    case when v_tot_pro = 0 then 'SKIPPED - no rows to hide'
         when v_see_pro = 0 then 'OK'
         else 'FAIL - cross-account leak' end);

  insert into _v values (10, 'Forged owner_id insert',
    case v_forge
      when 'RLS'      then 'rejected by RLS (42501)'
      when 'FK'       then 'rejected by FK before RLS was reached'
      else                 'row was accepted' end,
    case v_forge
      when 'RLS'      then 'OK'
      when 'FK'       then 'INCONCLUSIVE - blocked, but not by the policy; unexpected'
      else                 'FAIL - with-check is not stopping owner_id spoofing' end);

  insert into _v values (0, 'Context',
    v_tot_pro || ' profile(s), ' || v_tot_emp || ' employees, ' || v_tot_att || ' attendance rows',
    case when v_tot_emp > 0 then 'OK - isolation checks had real rows to hide'
         else 'NOTE - add a Saathi on one account for a stronger check 9' end);

exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  delete from public.employees where name = '__verify_forged__';
  insert into _v values (9, 'RLS isolation / spoofing', sqlstate || ': ' || sqlerrm,
    'ERROR - checks 9-10 aborted, role reset and rows cleaned up');
end $block$;

-- ---- C. remove the throwaway row -----------------------------------------
do $block$
declare v_left int;
begin
  delete from public.employees where name in ('__verify__','__verify2__','__verify_forged__');
  select count(*) into v_left from public.employees
    where name in ('__verify__','__verify2__','__verify_forged__');
  insert into _v values (12, 'Cleanup', 'throwaway rows remaining: ' || v_left,
    case when v_left = 0 then 'OK' else 'FAIL - delete them by hand' end);
exception when others then
  insert into _v values (12, 'Cleanup', sqlstate || ': ' || sqlerrm,
    'ERROR - delete employees named __verify__ by hand');
end $block$;

-- ------------------------------------------------------------- the one grid
select
  case when v.verdict like 'OK%'           then 'OK'
       when v.verdict like 'SKIPPED%'      then '--'
       when v.verdict like 'NOTE%'         then 'i'
       when v.verdict like 'INCONCLUSIVE%' then '?'
       else 'XX' end as status,
  v.check_name,
  v.detail,
  v.verdict
from _v v
order by (v.verdict like 'FAIL%' or v.verdict like 'ERROR%') desc,  -- failures first
         v.id, v.detail;

commit;
