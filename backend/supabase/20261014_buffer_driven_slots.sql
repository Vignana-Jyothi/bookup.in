-- Make merchant buffer part of the generated slot cadence and enforce it at write time.

create or replace function public.is_generated_booking_slot_v1(
  p_provider_id uuid,
  p_service_id uuid,
  p_booking_date date,
  p_start_time time
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_duration integer;
  v_buffer integer;
  v_timezone text;
  v_min_notice integer;
  v_max_advance integer;
  v_day text;
  v_open time;
  v_close time;
  v_active boolean;
  v_open_min integer;
  v_close_min integer;
  v_start_min integer;
  v_step integer;
  v_local_now timestamp;
  v_local_start timestamp;
begin
  select greatest(s.duration, 1), greatest(coalesce(p.buffer_time, 0), 0),
         coalesce(nullif(p.timezone, ''), 'Asia/Kolkata'),
         greatest(coalesce(p.min_notice, 0), 0),
         greatest(coalesce(p.max_advance_booking, 30), 1)
  into v_duration, v_buffer, v_timezone, v_min_notice, v_max_advance
  from public.services s
  join public.providers p on p.id = s.provider_id
  where s.id = p_service_id and s.provider_id = p_provider_id and s.active = true;

  if not found then return false; end if;

  v_day := case extract(isodow from p_booking_date)
    when 1 then 'monday' when 2 then 'tuesday' when 3 then 'wednesday'
    when 4 then 'thursday' when 5 then 'friday' when 6 then 'saturday'
    else 'sunday' end;

  select a.start_time::time, a.end_time::time, a.active
  into v_open, v_close, v_active
  from public.availability a
  where a.provider_id = p_provider_id and lower(a.day_of_week) = v_day;

  if not found then
    v_open := '09:00'::time;
    v_close := '18:00'::time;
    v_active := v_day <> 'sunday';
  end if;
  if not v_active then return false; end if;

  v_local_now := clock_timestamp() at time zone v_timezone;
  v_local_start := p_booking_date + p_start_time;
  if p_booking_date < v_local_now::date
     or p_booking_date > v_local_now::date + v_max_advance
     or v_local_start < v_local_now + make_interval(hours => v_min_notice) then
    return false;
  end if;

  v_open_min := extract(hour from v_open)::integer * 60 + extract(minute from v_open)::integer;
  v_close_min := extract(hour from v_close)::integer * 60 + extract(minute from v_close)::integer;
  v_start_min := extract(hour from p_start_time)::integer * 60 + extract(minute from p_start_time)::integer;
  v_step := v_duration + v_buffer;

  return v_start_min >= v_open_min
    and v_start_min + v_duration <= v_close_min
    and mod(v_start_min - v_open_min, v_step) = 0;
exception when others then
  return false;
end;
$$;

create or replace function public.enforce_generated_booking_slot_v1()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_generated_booking_slot_v1(
    new.provider_id,
    new.service_id,
    new.booking_date,
    new.start_time::time
  ) then
    raise exception 'INVALID_SLOT';
  end if;
  return new;
end;
$$;

drop trigger if exists booking_attempts_generated_slot_v1 on app.booking_attempts;
create trigger booking_attempts_generated_slot_v1
before insert or update of provider_id, service_id, booking_date, start_time
on app.booking_attempts
for each row execute function public.enforce_generated_booking_slot_v1();

drop trigger if exists bookings_generated_slot_v1 on public.bookings;
create trigger bookings_generated_slot_v1
before insert or update of provider_id, service_id, booking_date, start_time
on public.bookings
for each row execute function public.enforce_generated_booking_slot_v1();

revoke all on function public.is_generated_booking_slot_v1(uuid, uuid, date, time) from public, anon, authenticated;
revoke all on function public.enforce_generated_booking_slot_v1() from public, anon, authenticated;
grant execute on function public.is_generated_booking_slot_v1(uuid, uuid, date, time) to service_role;

comment on function public.is_generated_booking_slot_v1 is
  'Validates working hours, notice, horizon, service duration, and duration-plus-buffer cadence.';
