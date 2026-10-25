-- Run only against an isolated database after all migrations. No row mutations.
do $$
declare operation record;
begin
  if to_regprocedure('public.reschedule_booking_atomic(uuid,date,text)') is null then
    raise exception 'Missing legacy reschedule function';
  end if;
  for operation in
    select p.oid, p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_booking_atomic', 'reschedule_booking_atomic')
  loop
    if has_function_privilege('anon', operation.oid, 'EXECUTE')
      or has_function_privilege('authenticated', operation.oid, 'EXECUTE') then
      raise exception 'Public mutation privilege remains: %', operation.signature;
    end if;
    if not has_function_privilege('service_role', operation.oid, 'EXECUTE') then
      raise exception 'Backend mutation privilege missing: %', operation.signature;
    end if;
  end loop;
end $$;
