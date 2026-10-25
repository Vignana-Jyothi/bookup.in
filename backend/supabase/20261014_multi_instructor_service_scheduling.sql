-- Service weekday restrictions and instructor-owned booking resources.

create table if not exists public.instructors (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 100),
  active boolean not null default true,
  is_owner boolean not null default false,
  buffer_time integer check (buffer_time is null or buffer_time between 0 and 240),
  min_notice integer check (min_notice is null or min_notice between 0 and 720),
  max_advance_booking integer check (max_advance_booking is null or max_advance_booking between 1 and 365),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, provider_id)
);

create unique index if not exists instructors_one_owner_per_provider
  on public.instructors(provider_id) where is_owner;
create index if not exists instructors_provider_id on public.instructors(provider_id);

create table if not exists public.instructor_availability (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.instructors(id) on delete cascade,
  day_of_week text not null check (day_of_week in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
  start_time time not null default '09:00',
  end_time time not null default '18:00',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (instructor_id, day_of_week),
  check (end_time > start_time)
);
create index if not exists instructor_availability_instructor_id
  on public.instructor_availability(instructor_id);

insert into public.instructors(provider_id, name, active, is_owner)
select p.id, coalesce(nullif(trim(p.name), ''), 'Owner'), true, true
from public.providers p
where not exists (select 1 from public.instructors i where i.provider_id = p.id and i.is_owner);

insert into public.instructor_availability(instructor_id, day_of_week, start_time, end_time, active)
select i.id, d.day_name,
       case when a.start_time is not null and a.end_time is not null and a.start_time::time < a.end_time::time
         then a.start_time::time else '09:00'::time end,
       case when a.start_time is not null and a.end_time is not null and a.start_time::time < a.end_time::time
         then a.end_time::time else '18:00'::time end,
       coalesce(a.active, d.day_name <> 'sunday')
from public.instructors i
cross join (values ('monday'),('tuesday'),('wednesday'),('thursday'),('friday'),('saturday'),('sunday')) d(day_name)
left join public.availability a on a.provider_id = i.provider_id and lower(a.day_of_week) = d.day_name
on conflict (instructor_id, day_of_week) do nothing;

alter table public.services
  add column if not exists instructor_id uuid,
  add column if not exists available_weekdays text[];

update public.services s
set instructor_id = i.id
from public.instructors i
where s.instructor_id is null and i.provider_id = s.provider_id and i.is_owner;

update public.services
set available_weekdays = array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']::text[]
where available_weekdays is null;

alter table public.services alter column instructor_id set not null;
alter table public.services alter column available_weekdays set not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'services_instructor_provider_fkey') then
    alter table public.services add constraint services_instructor_provider_fkey
      foreign key (instructor_id, provider_id) references public.instructors(id, provider_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'services_available_weekdays_valid') then
    alter table public.services add constraint services_available_weekdays_valid check (
      cardinality(available_weekdays) between 1 and 7
      and available_weekdays <@ array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']::text[]
    );
  end if;
end $$;
create index if not exists services_instructor_id on public.services(instructor_id);

alter table app.booking_attempts add column if not exists instructor_id uuid references public.instructors(id) on delete restrict;
alter table app.slot_allocations add column if not exists instructor_id uuid references public.instructors(id) on delete restrict;
alter table app.appointments add column if not exists instructor_id uuid references public.instructors(id) on delete restrict;
alter table public.bookings add column if not exists instructor_id uuid references public.instructors(id) on delete restrict;

update app.booking_attempts ba set instructor_id = s.instructor_id from public.services s
where ba.instructor_id is null and s.id = ba.service_id;
update app.slot_allocations sa set instructor_id = ba.instructor_id from app.booking_attempts ba
where sa.instructor_id is null and ba.id = sa.attempt_id;
update app.appointments a set instructor_id = ba.instructor_id from app.booking_attempts ba
where a.instructor_id is null and ba.id = a.booking_attempt_id;
update public.bookings b set instructor_id = s.instructor_id from public.services s
where b.instructor_id is null and s.id = b.service_id;

alter table app.booking_attempts alter column instructor_id set not null;
alter table app.slot_allocations alter column instructor_id set not null;
alter table app.appointments alter column instructor_id set not null;

create or replace function public.assign_booking_instructor_v1()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
declare v_instructor_id uuid;
begin
  select instructor_id into v_instructor_id from public.services
  where id = new.service_id and provider_id = new.provider_id;
  if v_instructor_id is null then raise exception 'INSTRUCTOR_NOT_ASSIGNED'; end if;
  new.instructor_id := v_instructor_id;
  return new;
end;
$$;

create or replace function public.assign_allocation_instructor_v1()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
declare v_attempt app.booking_attempts%rowtype; v_buffer integer;
begin
  select * into v_attempt from app.booking_attempts where id = new.attempt_id;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  new.instructor_id := v_attempt.instructor_id;
  select greatest(coalesce(i.buffer_time, p.buffer_time, 0), 0) into v_buffer
  from public.instructors i join public.providers p on p.id = i.provider_id
  where i.id = v_attempt.instructor_id;
  new.occupancy_ends_at := v_attempt.ends_at + make_interval(mins => coalesce(v_buffer, 0));
  return new;
end;
$$;

drop trigger if exists booking_attempts_assign_instructor_v1 on app.booking_attempts;
create trigger booking_attempts_assign_instructor_v1 before insert or update of provider_id, service_id
on app.booking_attempts for each row execute function public.assign_booking_instructor_v1();
drop trigger if exists bookings_assign_instructor_v1 on public.bookings;
create trigger bookings_assign_instructor_v1 before insert or update of provider_id, service_id
on public.bookings for each row execute function public.assign_booking_instructor_v1();
drop trigger if exists slot_allocations_assign_instructor_v1 on app.slot_allocations;
create trigger slot_allocations_assign_instructor_v1 before insert or update of attempt_id
on app.slot_allocations for each row execute function public.assign_allocation_instructor_v1();
drop trigger if exists appointments_assign_instructor_v1 on app.appointments;
create trigger appointments_assign_instructor_v1 before insert or update of provider_id, service_id
on app.appointments for each row execute function public.assign_booking_instructor_v1();

create or replace function public.guard_booking_attempt_resource_v1()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
declare v_timezone text; v_buffer integer; v_start_min integer; v_end_min integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.instructor_id::text, 41));
  select coalesce(nullif(p.timezone, ''), 'Asia/Kolkata'), greatest(coalesce(i.buffer_time, p.buffer_time, 0), 0)
  into v_timezone, v_buffer from public.instructors i join public.providers p on p.id = i.provider_id
  where i.id = new.instructor_id;
  v_start_min := extract(hour from new.start_time)::integer * 60 + extract(minute from new.start_time)::integer;
  v_end_min := extract(hour from (new.ends_at at time zone v_timezone))::integer * 60
    + extract(minute from (new.ends_at at time zone v_timezone))::integer + v_buffer;
  if exists (
    select 1 from public.bookings b where b.instructor_id = new.instructor_id
      and b.booking_date = new.booking_date and b.status in ('confirmed', 'completed')
      and coalesce(b.payment_status, '') <> 'rejected'
      and v_start_min < ((split_part(coalesce(b.actual_end_time, b.end_time), ':', 1)::integer * 60)
        + split_part(coalesce(b.actual_end_time, b.end_time), ':', 2)::integer + v_buffer)
      and v_end_min > ((split_part(b.start_time, ':', 1)::integer * 60) + split_part(b.start_time, ':', 2)::integer)
  ) then raise exception 'SLOT_UNAVAILABLE'; end if;
  return new;
end;
$$;

create or replace function public.guard_legacy_booking_resource_v1()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
declare v_timezone text; v_buffer integer; v_starts_at timestamptz; v_ends_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.instructor_id::text, 41));
  select coalesce(nullif(p.timezone, ''), 'Asia/Kolkata'), greatest(coalesce(i.buffer_time, p.buffer_time, 0), 0)
  into v_timezone, v_buffer from public.instructors i join public.providers p on p.id = i.provider_id
  where i.id = new.instructor_id;
  v_starts_at := (new.booking_date + new.start_time::time) at time zone v_timezone;
  v_ends_at := (new.booking_date + coalesce(new.actual_end_time, new.end_time)::time) at time zone v_timezone
    + make_interval(mins => v_buffer);
  if exists (
    select 1 from app.slot_allocations sa where sa.instructor_id = new.instructor_id
      and (sa.status in ('reserved', 'manual_review') or (sa.status = 'held' and sa.hold_expires_at > clock_timestamp()))
      and tstzrange(sa.starts_at, sa.occupancy_ends_at, '[)') && tstzrange(v_starts_at, v_ends_at, '[)')
  ) then raise exception 'SLOT_UNAVAILABLE'; end if;
  return new;
end;
$$;

drop trigger if exists booking_attempts_resource_guard_v1 on app.booking_attempts;
create trigger booking_attempts_resource_guard_v1 before insert or update of booking_date, start_time, service_id
on app.booking_attempts for each row execute function public.guard_booking_attempt_resource_v1();
drop trigger if exists bookings_resource_guard_v1 on public.bookings;
create trigger bookings_resource_guard_v1 before insert or update of booking_date, start_time, service_id
on public.bookings for each row execute function public.guard_legacy_booking_resource_v1();

alter table app.slot_allocations drop constraint if exists slot_allocations_no_overlap_v1;
alter table app.slot_allocations add constraint slot_allocations_no_overlap_v1
  exclude using gist (
    instructor_id with =,
    tstzrange(starts_at, occupancy_ends_at, '[)') with &&
  ) where (status in ('held', 'manual_review', 'reserved'));

create or replace function public.is_generated_booking_slot_v1(
  p_provider_id uuid, p_service_id uuid, p_booking_date date, p_start_time time
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_duration integer; v_buffer integer; v_timezone text; v_min_notice integer; v_max_advance integer;
  v_instructor_id uuid; v_weekdays text[]; v_day text;
  v_provider_open time; v_provider_close time; v_provider_active boolean;
  v_instructor_open time; v_instructor_close time; v_instructor_active boolean;
  v_open time; v_close time; v_open_min integer; v_close_min integer; v_start_min integer; v_step integer;
  v_local_now timestamp; v_local_start timestamp;
begin
  select greatest(s.duration, 1), greatest(coalesce(i.buffer_time, p.buffer_time, 0), 0),
         coalesce(nullif(p.timezone, ''), 'Asia/Kolkata'),
         greatest(coalesce(i.min_notice, p.min_notice, 0), 0),
         greatest(coalesce(i.max_advance_booking, p.max_advance_booking, 30), 1),
         s.instructor_id, s.available_weekdays
  into v_duration, v_buffer, v_timezone, v_min_notice, v_max_advance, v_instructor_id, v_weekdays
  from public.services s join public.providers p on p.id = s.provider_id
  join public.instructors i on i.id = s.instructor_id and i.provider_id = s.provider_id and i.active
  where s.id = p_service_id and s.provider_id = p_provider_id and s.active;
  if not found then return false; end if;

  v_day := case extract(isodow from p_booking_date)
    when 1 then 'monday' when 2 then 'tuesday' when 3 then 'wednesday' when 4 then 'thursday'
    when 5 then 'friday' when 6 then 'saturday' else 'sunday' end;
  if not (v_day = any(v_weekdays)) then return false; end if;

  select a.start_time::time, a.end_time::time, a.active into v_provider_open, v_provider_close, v_provider_active
  from public.availability a where a.provider_id = p_provider_id and lower(a.day_of_week) = v_day;
  if not found then v_provider_open := '09:00'; v_provider_close := '18:00'; v_provider_active := v_day <> 'sunday'; end if;

  select ia.start_time, ia.end_time, ia.active into v_instructor_open, v_instructor_close, v_instructor_active
  from public.instructor_availability ia where ia.instructor_id = v_instructor_id and ia.day_of_week = v_day;
  if not found then v_instructor_open := v_provider_open; v_instructor_close := v_provider_close; v_instructor_active := v_provider_active; end if;
  if not v_provider_active or not v_instructor_active then return false; end if;

  v_open := greatest(v_provider_open, v_instructor_open);
  v_close := least(v_provider_close, v_instructor_close);
  v_local_now := clock_timestamp() at time zone v_timezone;
  v_local_start := p_booking_date + p_start_time;
  if p_booking_date < v_local_now::date or p_booking_date > v_local_now::date + v_max_advance
     or v_local_start < v_local_now + make_interval(hours => v_min_notice) then return false; end if;

  v_open_min := extract(hour from v_open)::integer * 60 + extract(minute from v_open)::integer;
  v_close_min := extract(hour from v_close)::integer * 60 + extract(minute from v_close)::integer;
  v_start_min := extract(hour from p_start_time)::integer * 60 + extract(minute from p_start_time)::integer;
  v_step := v_duration + v_buffer;
  return v_start_min >= v_open_min and v_start_min + v_duration <= v_close_min
    and mod(v_start_min - v_open_min, v_step) = 0;
exception when others then return false;
end;
$$;

create or replace function public.get_service_busy_slots_v1(
  p_provider_id uuid, p_service_id uuid, p_booking_date date
) returns table(start_time time, end_time time, actual_end_time time)
language sql stable security definer
set search_path = pg_catalog, public, app
as $$
  with target as (
    select instructor_id from public.services where id = p_service_id and provider_id = p_provider_id and active
  )
  select ba.start_time,
    (ba.ends_at at time zone coalesce(nullif(p.timezone, ''), 'Asia/Kolkata'))::time,
    null::time
  from app.slot_allocations sa
  join target t on t.instructor_id = sa.instructor_id
  join app.booking_attempts ba on ba.id = sa.attempt_id
  join public.providers p on p.id = sa.provider_id
  where sa.provider_id = p_provider_id and ba.booking_date = p_booking_date
    and (sa.status in ('reserved','manual_review') or (sa.status = 'held' and sa.hold_expires_at > clock_timestamp()))
  order by ba.start_time;
$$;

alter table public.instructors enable row level security;
alter table public.instructor_availability enable row level security;
drop policy if exists "Public can view active instructors" on public.instructors;
create policy "Public can view active instructors" on public.instructors for select using (active);
drop policy if exists "Public can view instructor availability" on public.instructor_availability;
create policy "Public can view instructor availability" on public.instructor_availability for select using (
  instructor_id in (select id from public.instructors where active)
);
grant select on public.instructors, public.instructor_availability to anon, authenticated;
revoke all on function public.get_service_busy_slots_v1(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.get_service_busy_slots_v1(uuid, uuid, date) to service_role;
revoke all on function public.assign_booking_instructor_v1() from public, anon, authenticated;
revoke all on function public.assign_allocation_instructor_v1() from public, anon, authenticated;
revoke all on function public.guard_booking_attempt_resource_v1() from public, anon, authenticated;
revoke all on function public.guard_legacy_booking_resource_v1() from public, anon, authenticated;

create or replace function public.get_merchant_cashfree_appointments_v1(
  p_provider_id uuid
) returns jsonb
language sql stable security definer
set search_path = pg_catalog, public, app, finance
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'providerId', a.provider_id,
    'serviceId', a.service_id,
    'serviceName', coalesce(s.name, 'Service'),
    'instructorId', a.instructor_id,
    'instructorName', coalesce(i.name, 'Owner'),
    'customerName', a.customer_name,
    'customerPhone', a.customer_phone,
    'customerWhatsApp', a.customer_phone,
    'customerEmail', coalesce(a.customer_email, ''),
    'date', to_char(a.starts_at at time zone coalesce(p.timezone, 'Asia/Kolkata'), 'YYYY-MM-DD'),
    'startTime', to_char(a.starts_at at time zone coalesce(p.timezone, 'Asia/Kolkata'), 'HH24:MI'),
    'endTime', to_char(a.ends_at at time zone coalesce(p.timezone, 'Asia/Kolkata'), 'HH24:MI'),
    'duration', greatest(1, floor(extract(epoch from (a.ends_at - a.starts_at)) / 60)::integer),
    'price', po.amount_paise::numeric / 100,
    'depositAmount', 0,
    'depositStatus', 'na',
    'status', case when a.status in ('customer_no_show', 'merchant_no_show') then 'no-show' else a.status end,
    'paymentStatus', 'confirmed',
    'paymentConfirmedAt', po.paid_at,
    'meetingType', a.meeting_type,
    'createdAt', a.created_at,
    'sourceSystem', 'cashfree_v1'
  ) order by a.starts_at desc), '[]'::jsonb)
  from app.appointments a
  join public.providers p on p.id = a.provider_id
  left join public.services s on s.id = a.service_id
  left join public.instructors i on i.id = a.instructor_id
  join finance.payment_orders po on po.id = a.payment_order_id
  where a.provider_id = p_provider_id
    and po.payment_status = 'succeeded'
    and po.fulfilment_status = 'fulfilled';
$$;

revoke all on function public.get_merchant_cashfree_appointments_v1(uuid) from public, anon, authenticated;
grant execute on function public.get_merchant_cashfree_appointments_v1(uuid) to service_role;

-- Keep the no-payment/legacy booking path resource-aware as well.
create or replace function public.create_booking_atomic(
  p_provider_id uuid, p_service_id uuid, p_customer_name text, p_customer_email text,
  p_customer_phone text, p_customer_whatsapp text, p_booking_date date, p_start_time text,
  p_notes text default '', p_management_token_hash text default null,
  p_meeting_type text default null, p_location_address text default null, p_maps_link text default null
) returns json language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_service public.services%rowtype; v_provider public.providers%rowtype;
  v_start_h integer; v_start_m integer; v_start_min integer; v_end_min integer;
  v_end_time text; v_customer_id uuid; v_booking_id uuid; v_conflict_count integer := 0;
  v_cand_end integer; v_buffer integer; v_resolved_meeting_type text;
  v_resolved_location text; v_resolved_maps_link text;
begin
  select * into v_service from public.services
  where id = p_service_id and provider_id = p_provider_id and active;
  if not found then return json_build_object('success', false, 'error', 'Invalid or inactive service'); end if;

  select * into v_provider from public.providers where id = p_provider_id for update;
  if not found then return json_build_object('success', false, 'error', 'Provider not found'); end if;

  if not public.is_generated_booking_slot_v1(p_provider_id, p_service_id, p_booking_date, p_start_time::time) then
    return json_build_object('success', false, 'error', 'This time is outside the service or instructor schedule.');
  end if;

  select greatest(coalesce(i.buffer_time, v_provider.buffer_time, 0), 0) into v_buffer
  from public.instructors i where i.id = v_service.instructor_id;
  v_resolved_meeting_type := coalesce(p_meeting_type,
    case when v_service.meeting_type = 'both' then 'online' else v_service.meeting_type end, 'online');
  if v_resolved_meeting_type = 'in-person' then
    v_resolved_location := coalesce(p_location_address, v_service.location_address, v_provider.default_location_address);
    v_resolved_maps_link := coalesce(p_maps_link, v_service.maps_link,
      case when v_resolved_location is not null then
        'https://www.google.com/maps/search/?api=1&query=' || replace(replace(v_resolved_location, ' ', '+'), ',', '%2C')
      end);
  end if;

  v_start_h := split_part(p_start_time, ':', 1)::integer;
  v_start_m := split_part(p_start_time, ':', 2)::integer;
  v_start_min := v_start_h * 60 + v_start_m;
  v_end_min := v_start_min + v_service.duration;
  v_end_time := to_char(to_timestamp(v_end_min * 60), 'HH24:MI');
  v_cand_end := v_end_min + v_buffer;

  perform id from public.bookings
  where provider_id = p_provider_id and instructor_id = v_service.instructor_id
    and booking_date = p_booking_date and status in ('confirmed', 'completed')
    and coalesce(payment_status, '') != 'rejected'
    and v_start_min < ((split_part(coalesce(actual_end_time, end_time), ':', 1)::integer * 60)
      + split_part(coalesce(actual_end_time, end_time), ':', 2)::integer + v_buffer)
    and v_cand_end > ((split_part(start_time, ':', 1)::integer * 60) + split_part(start_time, ':', 2)::integer)
  for update;
  get diagnostics v_conflict_count = row_count;
  if v_conflict_count > 0 then
    return json_build_object('success', false, 'error', 'This slot is no longer available. Please select another time.');
  end if;

  select id into v_customer_id from public.customers where phone = p_customer_phone limit 1;
  if v_customer_id is null then
    insert into public.customers(name, email, phone, whatsapp)
    values (p_customer_name, p_customer_email, p_customer_phone, coalesce(p_customer_whatsapp, p_customer_phone))
    returning id into v_customer_id;
  else
    update public.customers set name = p_customer_name, email = coalesce(p_customer_email, email),
      whatsapp = coalesce(p_customer_whatsapp, whatsapp) where id = v_customer_id;
  end if;

  insert into public.bookings(
    provider_id, service_id, customer_id, customer_name, customer_email, customer_phone,
    customer_whatsapp, booking_date, start_time, end_time, duration, price, deposit_amount,
    deposit_status, status, notes, management_token_hash, meeting_type,
    location_address_snapshot, maps_link_snapshot
  ) values (
    p_provider_id, v_service.id, v_customer_id, p_customer_name, p_customer_email, p_customer_phone,
    coalesce(p_customer_whatsapp, p_customer_phone), p_booking_date, p_start_time, v_end_time,
    v_service.duration, v_service.price, coalesce(v_service.deposit_amount, 0),
    case when coalesce(v_service.deposit_amount, 0) > 0 then 'paid' else 'na' end,
    'confirmed', p_notes, p_management_token_hash, v_resolved_meeting_type,
    v_resolved_location, v_resolved_maps_link
  ) returning id into v_booking_id;

  return json_build_object('success', true, 'bookingId', v_booking_id, 'endTime', v_end_time,
    'price', v_service.price, 'depositAmount', coalesce(v_service.deposit_amount, 0),
    'meetingType', v_resolved_meeting_type, 'locationAddress', v_resolved_location,
    'mapsLink', v_resolved_maps_link);
end;
$$;

revoke all on function public.create_booking_atomic(uuid, uuid, text, text, text, text, date, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_booking_atomic(uuid, uuid, text, text, text, text, date, text, text, text, text, text, text) to service_role;
