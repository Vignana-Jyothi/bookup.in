-- Add Cashfree v1 allocations to server-authoritative public availability.

create or replace function public.get_cashfree_busy_slots_v1(
  p_provider_id uuid,
  p_booking_date date
) returns table(start_time time, end_time time, actual_end_time time)
language sql security definer
set search_path = pg_catalog, public, app
as $$
  select
    ba.start_time,
    (ba.ends_at at time zone coalesce(nullif(p.timezone, ''), 'Asia/Kolkata'))::time as end_time,
    null::time as actual_end_time
  from app.slot_allocations sa
  join app.booking_attempts ba on ba.id = sa.attempt_id
  join public.providers p on p.id = sa.provider_id
  where sa.provider_id = p_provider_id
    and ba.booking_date = p_booking_date
    and (
      sa.status in ('reserved', 'manual_review')
      or (sa.status = 'held' and sa.hold_expires_at > clock_timestamp())
    )
  order by ba.start_time;
$$;

revoke all on function public.get_cashfree_busy_slots_v1(uuid, date) from public, anon, authenticated;
grant execute on function public.get_cashfree_busy_slots_v1(uuid, date) to service_role;

comment on function public.get_cashfree_busy_slots_v1 is
  'Returns PII-free active Cashfree allocation intervals to the server for public availability.';
