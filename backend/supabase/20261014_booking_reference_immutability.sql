-- Prevent public booking IDs from changing after appointment creation.

create or replace function app.prevent_booking_reference_change_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
  if new.booking_reference is distinct from old.booking_reference then
    raise exception 'BOOKING_REFERENCE_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_booking_reference_immutable_v1 on app.appointments;
create trigger appointments_booking_reference_immutable_v1
before update of booking_reference on app.appointments
for each row execute function app.prevent_booking_reference_change_v1();

revoke all on function app.prevent_booking_reference_change_v1() from public, anon, authenticated;

comment on function app.prevent_booking_reference_change_v1 is
  'Rejects changes to an appointment public booking ID after creation.';
