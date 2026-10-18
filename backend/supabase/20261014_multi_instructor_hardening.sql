-- Index resource foreign keys and keep booking creation behind the backend.

create index if not exists booking_attempts_instructor_id
  on app.booking_attempts(instructor_id);
create index if not exists appointments_instructor_id
  on app.appointments(instructor_id);
create index if not exists bookings_instructor_id
  on public.bookings(instructor_id);
create index if not exists services_instructor_provider_id
  on public.services(instructor_id, provider_id);

revoke all on function public.create_booking_atomic(
  uuid, uuid, text, text, text, text, date, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_booking_atomic(
  uuid, uuid, text, text, text, text, date, text, text, text, text, text, text
) to service_role;
