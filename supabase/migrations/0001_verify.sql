-- Phase 1 verification. Run after 0001_initial_schema.sql.
-- Every row returned should read OK; anything else is a failure to fix before Phase 2.

-- 1. All four tables exist and RLS is ON (Verification step 2).
select tablename,
       rowsecurity,
       case when rowsecurity then 'OK' else 'FAIL — RLS OFF' end as verdict
from pg_tables
where schemaname = 'public'
order by tablename;

-- 2. Policies are present: expect 3 on profiles, 1 each elsewhere.
select tablename, count(*) as policies,
       case
         when tablename = 'profiles'  and count(*) = 3 then 'OK'
         when tablename in ('employees','attendance','settings') and count(*) = 1 then 'OK'
         else 'FAIL — unexpected policy count'
       end as verdict
from pg_policies
where schemaname = 'public'
group by tablename
order by tablename;

-- 3. updated_at triggers are wired on all four tables.
select c.relname as table_name, t.tgname,
       case when t.tgname is not null then 'OK' else 'FAIL' end as verdict
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal and t.tgname like 'trg_%_touch'
order by c.relname;

-- 4. The signup trigger is attached to auth.users.
select tgname, case when count(*) over () = 1 then 'OK' else 'FAIL — missing' end as verdict
from pg_trigger
where tgname = 'on_auth_user_created' and not tgisinternal;

-- 5. updated_at cannot be forged by a client. Read the NOTICE output, not a result
--    grid: expect 'OK - trigger overrode...'. Inserts and deletes one throwaway
--    employees row owned by an existing profile, so it leaves no trace.
do $$
declare v_owner uuid; v_emp uuid := gen_random_uuid(); v_before timestamptz;
begin
  select id into v_owner from public.profiles limit 1;
  if v_owner is null then
    raise notice 'SKIPPED step 5 — no profiles row yet; re-run after the first signup.';
    return;
  end if;
  insert into public.employees (id, owner_id, name, wage_type, wage_amt)
    values (v_emp, v_owner, '__verify__', 'Monthly', 1);
  select updated_at into v_before from public.employees where id = v_emp;
  update public.employees
     set name = '__verify2__', updated_at = '2000-01-01'::timestamptz
   where id = v_emp;
  if (select updated_at from public.employees where id = v_emp) > v_before then
    raise notice 'OK — trigger overrode the client-supplied updated_at.';
  else
    raise warning 'FAIL — client was able to set updated_at.';
  end if;
  delete from public.employees where id = v_emp;
end $$;

-- 6. The `authenticated` role can actually reach the tables. Without these
--    privileges every app query fails with 42501 before RLS is even consulted.
--    Supabase grants more than these four (REFERENCES, TRIGGER, TRUNCATE);
--    only the four the app issues are required, so this checks for those
--    rather than counting rows.
select table_name,
       string_agg(privilege_type, ', ' order by privilege_type) as granted,
       case
         when count(*) filter (
           where privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
         ) = 4 then 'OK'
         else 'FAIL - missing one of SELECT/INSERT/UPDATE/DELETE'
       end as verdict
from information_schema.role_table_grants
where grantee = 'authenticated'
  and table_schema = 'public'
  and table_name in ('profiles', 'employees', 'attendance', 'settings')
group by table_name
order by table_name;
