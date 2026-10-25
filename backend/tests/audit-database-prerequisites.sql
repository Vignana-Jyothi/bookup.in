do $$ begin
  if to_regclass('auth.users') is null or to_regclass('public.providers') is null
    or to_regclass('public.instructors') is null or to_regclass('public.instructor_availability') is null
    or to_regclass('public.bookings') is null or to_regclass('public.customers') is null
    or to_regclass('app.merchant_entitlements') is null or to_regclass('finance.subscription_periods') is null
    or to_regprocedure('public.reschedule_booking_atomic(uuid,date,text)') is null
    or to_regprocedure('public.create_booking_atomic(uuid,uuid,text,text,text,text,date,text,text,text,text,text,text)') is null
    or to_regprocedure('public.mark_subscription_refund_v1(uuid,text,text,text)') is null then
    raise exception 'Install the existing Supabase base schema and all historical migrations before running audit checks';
  end if;
  if not exists(select 1 from pg_roles where rolname='anon')
    or not exists(select 1 from pg_roles where rolname='authenticated')
    or not exists(select 1 from pg_roles where rolname='service_role') then
    raise exception 'Supabase database roles are required';
  end if;
  if exists(select 1 from public.providers) or exists(select 1 from public.bookings)
    or exists(select 1 from auth.users) or exists(select 1 from public.customers) then
    raise exception 'Refusing nonempty database: use a disposable schema-only database without users, providers or bookings';
  end if;
end $$;
