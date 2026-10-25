-- Read-only installed-function contract. Run after the Calendar preflight migration in an isolated database.
do $$
declare fn oid; body text; result jsonb;
begin
  fn := pg_catalog.to_regprocedure('public.get_booking_calendar_preflight_v1(uuid,uuid,text,text)');
  if fn is null then raise exception 'Calendar preflight function is not installed'; end if;
  if pg_catalog.has_function_privilege('anon', fn, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', fn, 'EXECUTE')
    or not pg_catalog.has_function_privilege('service_role', fn, 'EXECUTE') then
    raise exception 'Calendar preflight must remain service-only';
  end if;
  if not exists(select 1 from pg_catalog.pg_proc where oid = fn and prosecdef and provolatile = 's'
    and proconfig @> array['search_path=""']) then
    raise exception 'Calendar preflight requires stable SECURITY DEFINER with empty search_path';
  end if;
  body := pg_catalog.lower(pg_catalog.pg_get_functiondef(fn));
  if pg_catalog.strpos(body, 'ba.provider_id = p_provider_id and ba.idempotency_key = p_idempotency_key') = 0
    or pg_catalog.strpos(body, 'v_request_hash is distinct from p_request_hash') = 0
    or pg_catalog.strpos(body, 's.id = p_service_id and s.provider_id = p_provider_id and s.active = true') = 0
    or pg_catalog.strpos(body, '''existingattempt'', true') = 0
    or pg_catalog.strpos(body, '''existingattempt'', true') > pg_catalog.strpos(body, 'from public.services') then
    raise exception 'Calendar preflight lost provider scoping or idempotency-before-readiness ordering';
  end if;
  begin
    perform public.get_booking_calendar_preflight_v1(null, null, null, null);
    raise exception 'Calendar preflight must reject empty request context';
  exception when raise_exception then
    if sqlerrm <> 'INVALID_REQUEST' then raise; end if;
  end;
end $$;
