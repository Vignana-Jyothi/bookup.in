-- Read-only deployment contract. Apply after the other 20261025 migrations.
begin;
create or replace function public.get_release_readiness_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  bookings_oid oid := pg_catalog.to_regclass('public.bookings');
  customers_oid oid := pg_catalog.to_regclass('public.customers');
  create_oid oid := pg_catalog.to_regprocedure('public.create_booking_atomic(uuid,uuid,text,text,text,text,date,text,text,text,text,text,text)');
  reschedule_oid oid := pg_catalog.to_regprocedure('public.reschedule_booking_atomic(uuid,date,text)');
  expiry_oid oid := pg_catalog.to_regprocedure('public.expire_legacy_booking_holds_v1(uuid,uuid,date)');
  guard_oid oid := pg_catalog.to_regprocedure('public.guard_booking_attempt_resource_v1()');
  refund_oid oid := pg_catalog.to_regprocedure('public.mark_subscription_refund_v1(uuid,text,text,text)');
  create_body text; reschedule_body text; expiry_body text; guard_body text; refund_body text;
  ready boolean := true;
begin
  if bookings_oid is null or customers_oid is null or create_oid is null
    or reschedule_oid is null or expiry_oid is null or guard_oid is null or refund_oid is null then
    return pg_catalog.jsonb_build_object('release','20261025-code-audit','ready',false);
  end if;

  -- Effective privileges include grants inherited from PUBLIC and other roles.
  ready := not pg_catalog.has_table_privilege('anon',bookings_oid,'INSERT')
    and not pg_catalog.has_table_privilege('authenticated',bookings_oid,'INSERT')
    and not pg_catalog.has_table_privilege('anon',bookings_oid,'SELECT')
    and not pg_catalog.has_table_privilege('anon',bookings_oid,'UPDATE')
    and not pg_catalog.has_table_privilege('anon',bookings_oid,'DELETE')
    and not pg_catalog.has_table_privilege('anon',customers_oid,'SELECT')
    and not pg_catalog.has_table_privilege('anon',customers_oid,'INSERT')
    and not pg_catalog.has_table_privilege('anon',customers_oid,'UPDATE')
    and not pg_catalog.has_table_privilege('anon',customers_oid,'DELETE')
    and not pg_catalog.has_table_privilege('authenticated',customers_oid,'INSERT')
    and not pg_catalog.has_table_privilege('authenticated',customers_oid,'UPDATE')
    and not pg_catalog.has_table_privilege('authenticated',customers_oid,'DELETE')
    and pg_catalog.has_table_privilege('service_role',bookings_oid,'INSERT')
    and pg_catalog.has_table_privilege('service_role',customers_oid,'INSERT');

  -- Column-specific grants survive a table-level REVOKE; reject those too.
  if exists (
    select 1 from (values
      ('anon',bookings_oid,'SELECT'), ('anon',bookings_oid,'INSERT'),
      ('anon',bookings_oid,'UPDATE'), ('authenticated',bookings_oid,'INSERT'),
      ('anon',customers_oid,'SELECT'), ('anon',customers_oid,'INSERT'),
      ('anon',customers_oid,'UPDATE'), ('authenticated',customers_oid,'INSERT'),
      ('authenticated',customers_oid,'UPDATE')
    ) as rights(role_name,relation_oid,privilege_name)
    where pg_catalog.has_any_column_privilege(rights.role_name,rights.relation_oid,rights.privilege_name)
  ) then ready := false; end if;

  -- Audit every historical mutation overload, not just the currently used one.
  if exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('create_booking_atomic','reschedule_booking_atomic','expire_legacy_booking_holds_v1')
      and (pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
        or pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
        or not pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE'))
  ) then ready := false; end if;

  if not exists(select 1 from pg_catalog.pg_class where oid=customers_oid and relrowsecurity)
    or not exists (
      select 1 from pg_catalog.pg_policy p where p.polrelid=customers_oid
        and p.polname='Providers can view own customers' and p.polcmd='r'
        and pg_catalog.pg_get_expr(p.polqual,p.polrelid) like '%auth.uid()%'
        and pg_catalog.pg_get_expr(p.polqual,p.polrelid) like '%user_id%'
    ) or exists (
      select 1 from pg_catalog.pg_policy p where p.polrelid=customers_oid
        and p.polcmd in ('r','*') and p.polname<>'Providers can view own customers'
    ) then ready := false; end if;

  create_body := pg_catalog.lower(pg_catalog.pg_get_functiondef(create_oid));
  reschedule_body := pg_catalog.lower(pg_catalog.pg_get_functiondef(reschedule_oid));
  expiry_body := pg_catalog.lower(pg_catalog.pg_get_functiondef(expiry_oid));
  guard_body := pg_catalog.lower(pg_catalog.pg_get_functiondef(guard_oid));
  refund_body := pg_catalog.lower(pg_catalog.pg_get_functiondef(refund_oid));
  if pg_catalog.strpos(create_body,'expire_legacy_booking_holds_v1')=0
    or pg_catalog.strpos(create_body,'status in (''pending'', ''pending_payment'', ''confirmed'', ''completed'')')=0
    or pg_catalog.strpos(create_body,'then ''pending_payment'' else ''confirmed''')=0
    or pg_catalog.strpos(create_body,'then ''awaiting_payment'' else ''not_required''')=0
    or pg_catalog.strpos(create_body,'then ''pending'' else ''na''')=0
    or pg_catalog.strpos(guard_body,'expire_legacy_booking_holds_v1')=0
    or pg_catalog.strpos(guard_body,'b.status in (''pending'', ''pending_payment'', ''confirmed'', ''completed'')')=0
    or pg_catalog.strpos(expiry_body,'pg_advisory_xact_lock')=0
    or pg_catalog.strpos(expiry_body,'status = ''cancelled'', payment_status = ''rejected''')=0
    or pg_catalog.strpos(expiry_body,'payment_status = ''awaiting_payment''')=0
    or pg_catalog.strpos(expiry_body,'created_at <= clock_timestamp() - interval ''30 minutes''')=0
    or pg_catalog.strpos(reschedule_body,'from public.providers where id = v_provider_id for update')=0
    or pg_catalog.strpos(reschedule_body,'perform public.expire_legacy_booking_holds_v1')=0
    or pg_catalog.strpos(reschedule_body,'from public.bookings where id = p_booking_id for update')=0
    or pg_catalog.strpos(reschedule_body,'from public.providers where id = v_provider_id for update')
      > pg_catalog.strpos(reschedule_body,'perform public.expire_legacy_booking_holds_v1')
    or pg_catalog.strpos(reschedule_body,'perform public.expire_legacy_booking_holds_v1')
      > pg_catalog.strpos(reschedule_body,'from public.bookings where id = p_booking_id for update')
    or pg_catalog.strpos(refund_body,'where id = p_refund_id for update')=0
    or pg_catalog.strpos(refund_body,'if v_current_status = ''succeeded'' then return true; end if;')=0
    or pg_catalog.strpos(refund_body,'if v_current_status = ''succeeded''')
      > pg_catalog.strpos(refund_body,'update finance.refunds_v1 set status = p_status') then
    ready := false;
  end if;
  return pg_catalog.jsonb_build_object('release','20261025-code-audit','ready',coalesce(ready,false));
exception when others then
  -- Missing roles/objects or inaccessible catalogs are an unavailable contract.
  return pg_catalog.jsonb_build_object('release','20261025-code-audit','ready',false);
end $$;
revoke all on function public.get_release_readiness_v1() from public, anon, authenticated;
grant execute on function public.get_release_readiness_v1() to service_role;
commit;
