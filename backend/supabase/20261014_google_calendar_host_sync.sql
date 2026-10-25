-- Durable Google Calendar and Meet synchronization for paid appointments.

alter table app.appointments add column if not exists google_event_id text;
alter table app.appointments add column if not exists meet_link text;
alter table app.appointments add column if not exists calendar_sync_status text not null default 'queued';
alter table app.appointments add column if not exists calendar_sync_attempt_count integer not null default 0;
alter table app.appointments add column if not exists calendar_sync_due_at timestamptz not null default now();
alter table app.appointments add column if not exists calendar_lease_owner text;
alter table app.appointments add column if not exists calendar_lease_generation bigint not null default 0;
alter table app.appointments add column if not exists calendar_lease_expires_at timestamptz;
alter table app.appointments add column if not exists calendar_synced_at timestamptz;
alter table app.appointments add column if not exists calendar_last_safe_error text;

alter table app.appointments drop constraint if exists appointments_calendar_sync_status_check;
alter table app.appointments add constraint appointments_calendar_sync_status_check
  check (calendar_sync_status in ('queued', 'leased', 'succeeded', 'not_required', 'dead_letter'));

update app.appointments
set calendar_sync_status = 'not_required'
where meeting_type = 'in-person' and google_event_id is null;

create unique index if not exists appointments_google_event_unique
  on app.appointments(provider_id, google_event_id)
  where google_event_id is not null;

create index if not exists appointments_calendar_sync_due
  on app.appointments(calendar_sync_due_at)
  where calendar_sync_status in ('queued', 'leased');

create or replace function public.claim_google_calendar_sync_v1(
  p_lease_owner text,
  p_limit integer default 10,
  p_lease_seconds integer default 60
) returns table(
  appointment_id uuid, lease_generation bigint, provider_id uuid, service_name text,
  customer_name text, customer_phone text, customer_email text, booking_date text,
  start_time text, end_time text, duration integer, amount numeric, meeting_type text,
  timezone text, merchant_email text
)
language sql security definer
set search_path = pg_catalog, public, app, finance, ops
as $$
  with due as (
    select a.id
    from app.appointments a
    where a.meeting_type = 'online'
      and a.google_event_id is null
      and ((a.calendar_sync_status = 'queued' and a.calendar_sync_due_at <= clock_timestamp())
        or (a.calendar_sync_status = 'leased' and a.calendar_lease_expires_at <= clock_timestamp()))
    order by a.calendar_sync_due_at
    for update skip locked
    limit greatest(1, least(p_limit, 50))
  ), claimed as (
    update app.appointments a
    set calendar_sync_status = 'leased',
        calendar_lease_owner = p_lease_owner,
        calendar_lease_generation = a.calendar_lease_generation + 1,
        calendar_lease_expires_at = clock_timestamp() + make_interval(secs => greatest(15, least(p_lease_seconds, 600))),
        calendar_sync_attempt_count = a.calendar_sync_attempt_count + 1
    from due
    where a.id = due.id
    returning a.*
  )
  select c.id, c.calendar_lease_generation, c.provider_id, coalesce(s.name, 'Service'),
    c.customer_name, c.customer_phone, coalesce(c.customer_email, ''),
    to_char(c.starts_at at time zone coalesce(p.timezone, 'Asia/Kolkata'), 'YYYY-MM-DD'),
    to_char(c.starts_at at time zone coalesce(p.timezone, 'Asia/Kolkata'), 'HH24:MI'),
    to_char(c.ends_at at time zone coalesce(p.timezone, 'Asia/Kolkata'), 'HH24:MI'),
    greatest(1, floor(extract(epoch from (c.ends_at - c.starts_at)) / 60)::integer),
    po.amount_paise::numeric / 100, c.meeting_type,
    coalesce(p.timezone, 'Asia/Kolkata'), lower(trim(coalesce(p.email, '')))
  from claimed c
  join public.providers p on p.id = c.provider_id
  left join public.services s on s.id = c.service_id
  join finance.payment_orders po on po.id = c.payment_order_id;
$$;

create or replace function public.complete_google_calendar_sync_v1(
  p_appointment_id uuid,
  p_lease_owner text,
  p_lease_generation bigint,
  p_succeeded boolean,
  p_google_event_id text default null,
  p_meet_link text default null,
  p_safe_error text default null,
  p_max_attempts integer default 8
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, app, ops
as $$
declare v_appointment app.appointments%rowtype;
begin
  select * into v_appointment from app.appointments
  where id = p_appointment_id and calendar_sync_status = 'leased'
    and calendar_lease_owner = p_lease_owner
    and calendar_lease_generation = p_lease_generation
  for update;
  if not found then return false; end if;

  if p_succeeded and p_google_event_id is not null then
    update app.appointments set google_event_id = p_google_event_id, meet_link = p_meet_link,
      calendar_sync_status = 'succeeded', calendar_synced_at = clock_timestamp(),
      calendar_lease_owner = null, calendar_lease_expires_at = null, calendar_last_safe_error = null
    where id = p_appointment_id;
  elsif v_appointment.calendar_sync_attempt_count >= greatest(1, p_max_attempts) then
    update app.appointments set calendar_sync_status = 'dead_letter',
      calendar_lease_owner = null, calendar_lease_expires_at = null,
      calendar_last_safe_error = left(p_safe_error, 200)
    where id = p_appointment_id;
  else
    update app.appointments set calendar_sync_status = 'queued',
      calendar_sync_due_at = clock_timestamp() + make_interval(secs => least(3600, 30 * v_appointment.calendar_sync_attempt_count)),
      calendar_lease_owner = null, calendar_lease_expires_at = null,
      calendar_last_safe_error = left(p_safe_error, 200)
    where id = p_appointment_id;
  end if;

  insert into ops.audit_events(provider_id, aggregate_type, aggregate_id, action, actor_type, safe_metadata)
  values (v_appointment.provider_id, 'appointment', p_appointment_id,
    case when p_succeeded then 'calendar.sync_succeeded'
      when v_appointment.calendar_sync_attempt_count >= greatest(1, p_max_attempts) then 'calendar.sync_dead_lettered'
      else 'calendar.sync_requeued' end,
    'worker', jsonb_build_object('leaseGeneration', p_lease_generation));
  return true;
end;
$$;

create or replace function public.requeue_google_calendar_sync_v1(p_provider_id uuid)
returns integer
language plpgsql security definer
set search_path = pg_catalog, app
as $$
declare v_count integer;
begin
  update app.appointments set calendar_sync_status = 'queued', calendar_sync_due_at = clock_timestamp(),
    calendar_lease_owner = null, calendar_lease_expires_at = null, calendar_last_safe_error = null
  where provider_id = p_provider_id and meeting_type = 'online' and google_event_id is null
    and calendar_sync_status in ('queued', 'dead_letter');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.get_appointment_meeting_v1(p_appointment_id uuid)
returns jsonb
language sql stable security definer
set search_path = pg_catalog, app
as $$
  select case when a.id is null then null else jsonb_build_object(
    'googleEventId', a.google_event_id,
    'meetLink', a.meet_link,
    'calendarSyncStatus', a.calendar_sync_status
  ) end
  from (select 1) seed
  left join app.appointments a on a.id = p_appointment_id;
$$;

revoke all on function public.claim_google_calendar_sync_v1(text, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_google_calendar_sync_v1(uuid, text, bigint, boolean, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.requeue_google_calendar_sync_v1(uuid) from public, anon, authenticated;
revoke all on function public.get_appointment_meeting_v1(uuid) from public, anon, authenticated;
grant execute on function public.claim_google_calendar_sync_v1(text, integer, integer) to service_role;
grant execute on function public.complete_google_calendar_sync_v1(uuid, text, bigint, boolean, text, text, text, integer) to service_role;
grant execute on function public.requeue_google_calendar_sync_v1(uuid) to service_role;
grant execute on function public.get_appointment_meeting_v1(uuid) to service_role;
