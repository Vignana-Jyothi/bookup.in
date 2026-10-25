-- Read-only Calendar preflight; acquire_booking_hold_v1 remains the transactional authority.
begin;
create or replace function public.get_booking_calendar_preflight_v1(
  p_provider_id uuid, p_service_id uuid, p_idempotency_key text, p_request_hash text
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_request_hash text;
  v_service_id uuid;
  v_instructor_id uuid;
  v_duration integer;
  v_timezone text;
begin
  if p_provider_id is null or p_service_id is null
    or nullif(p_idempotency_key, '') is null or nullif(p_request_hash, '') is null then
    raise exception 'INVALID_REQUEST';
  end if;

  select ba.request_hash into v_request_hash
  from app.booking_attempts ba
  where ba.provider_id = p_provider_id and ba.idempotency_key = p_idempotency_key;
  if found then
    if v_request_hash is distinct from p_request_hash then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object('existingAttempt', true);
  end if;

  select s.id, s.instructor_id, s.duration into v_service_id, v_instructor_id, v_duration
  from public.services s
  where s.id = p_service_id and s.provider_id = p_provider_id and s.active = true;
  if not found then raise exception 'SERVICE_NOT_FOUND'; end if;

  select p.timezone into v_timezone from public.providers p where p.id = p_provider_id;
  if not found then raise exception 'PROVIDER_NOT_FOUND'; end if;

  return pg_catalog.jsonb_build_object('existingAttempt', false,
    'service', pg_catalog.jsonb_build_object('id', v_service_id, 'instructor_id', v_instructor_id, 'duration', v_duration),
    'provider', pg_catalog.jsonb_build_object('timezone', coalesce(v_timezone, 'Asia/Kolkata')));
end $$;
revoke all on function public.get_booking_calendar_preflight_v1(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.get_booking_calendar_preflight_v1(uuid, uuid, text, text) to service_role;
commit;
