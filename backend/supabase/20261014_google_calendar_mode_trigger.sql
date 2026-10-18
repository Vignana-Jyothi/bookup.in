-- Keep calendar-sync state aligned with the appointment meeting mode.

create or replace function app.set_appointment_calendar_sync_mode_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, app
as $$
begin
  if new.meeting_type = 'in-person' and new.google_event_id is null then
    new.calendar_sync_status := 'not_required';
  elsif new.meeting_type = 'online' and new.google_event_id is null
    and new.calendar_sync_status = 'not_required' then
    new.calendar_sync_status := 'queued';
    new.calendar_sync_due_at := clock_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_calendar_sync_mode_v1 on app.appointments;
create trigger appointments_calendar_sync_mode_v1
before insert or update of meeting_type on app.appointments
for each row execute function app.set_appointment_calendar_sync_mode_v1();
