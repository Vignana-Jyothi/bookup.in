-- Legacy mutation RPCs are called only by authenticated/token-authorized backend
-- routes. Cover every historical create overload, including schema.sql's older
-- signature, so an obsolete overload cannot retain PostgreSQL's PUBLIC grant.
do $$
declare operation record;
begin
  for operation in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_booking_atomic', 'reschedule_booking_atomic')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', operation.signature);
    execute format('grant execute on function %s to service_role', operation.signature);
  end loop;
end $$;
