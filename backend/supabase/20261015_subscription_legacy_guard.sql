begin;

drop trigger if exists legacy_booking_entitlement_guard_v1 on public.bookings;
create trigger legacy_booking_entitlement_guard_v1
before insert on public.bookings
for each row execute function app.enforce_booking_entitlement_v1();

commit;
