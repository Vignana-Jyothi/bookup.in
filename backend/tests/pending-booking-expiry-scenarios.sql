-- ISOLATED DATABASE ONLY, after the new migrations. No production table writes.
-- Execute the installed helper body against a transaction-local fixture table.
-- This verifies predicates/CAS outcomes; two-connection lock tests remain separate.
begin;
create temporary table expiry_booking_fixture (
  id integer primary key, provider_id uuid, instructor_id uuid,
  booking_date date, status text, payment_status text,
  created_at timestamptz, updated_at timestamptz
) on commit drop;
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.expire_legacy_booking_holds_v1(uuid,uuid,date)'::regprocedure);
  definition := replace(definition, 'public.expire_legacy_booking_holds_v1(', 'pg_temp.expire_legacy_booking_holds_v1(');
  definition := replace(definition, 'public.bookings', 'pg_temp.expiry_booking_fixture');
  execute definition;
end $$;
insert into expiry_booking_fixture values
  (1,'11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','2090-01-02','pending_payment','awaiting_payment',clock_timestamp()-interval '31 minutes',null),
  (2,'11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','2090-01-02','pending_payment','verification_pending',clock_timestamp()-interval '1 day',null),
  (3,'11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','2090-01-02','confirmed','confirmed',clock_timestamp()-interval '1 day',null),
  (4,'11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','2090-01-02','pending_payment','awaiting_payment',clock_timestamp()-interval '1 minute',null),
  (5,'11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','2090-01-02','pending_payment','awaiting_payment',clock_timestamp()-interval '1 day',null),
  (6,'11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','2090-01-03','pending_payment','awaiting_payment',clock_timestamp()-interval '1 day',null),
  (7,'11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','2090-01-02','pending_payment','awaiting_payment',clock_timestamp()-interval '30 minutes',null);
select pg_temp.expire_legacy_booking_holds_v1('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','2090-01-02');
do $$
begin
  if (select count(*) from expiry_booking_fixture where id in (1,7) and status='cancelled' and payment_status='rejected') <> 2 then
    raise exception 'Expired awaiting holds, including deadline boundary, must become terminal';
  end if;
  if exists(select 1 from expiry_booking_fixture where id in (2,3,4,5,6) and updated_at is not null) then
    raise exception 'Submitted/confirmed/live/unrelated reservations must remain untouched';
  end if;
  update expiry_booking_fixture set payment_status='verification_pending'
  where id=1 and status='pending_payment' and payment_status='awaiting_payment';
  if found then raise exception 'A stale mark-paid CAS revived an expired reservation'; end if;
end $$;
rollback;
