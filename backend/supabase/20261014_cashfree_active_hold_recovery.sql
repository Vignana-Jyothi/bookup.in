-- Return a safe active-hold conflict projection to the server. This avoids
-- exposing the private app schema through PostgREST.

create or replace function public.get_active_hold_conflict_v1(
  p_provider_id uuid,
  p_customer_contact_hash text,
  p_attempt_token_hash text default null
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, app
as $$
declare
  v_attempt app.booking_attempts%rowtype;
  v_same_browser boolean;
begin
  select * into v_attempt
  from app.booking_attempts
  where provider_id = p_provider_id
    and customer_contact_hash = p_customer_contact_hash
    and status in ('hold_active', 'manual_review')
  order by created_at desc
  limit 1;

  if not found then return null; end if;
  v_same_browser := p_attempt_token_hash is not null
    and p_attempt_token_hash = v_attempt.attempt_token_hash;

  return jsonb_build_object(
    'remainingSeconds', greatest(0, floor(extract(epoch from (v_attempt.hold_expires_at - clock_timestamp())))::integer),
    'holdExpiresAt', v_attempt.hold_expires_at,
    'holdStatus', v_attempt.status,
    'canResume', v_same_browser
  ) || case when v_same_browser
    then jsonb_build_object('attemptId', v_attempt.id)
    else '{}'::jsonb
  end;
end;
$$;

revoke all on function public.get_active_hold_conflict_v1(uuid, text, text) from public, anon, authenticated;
grant execute on function public.get_active_hold_conflict_v1(uuid, text, text) to service_role;

comment on function public.get_active_hold_conflict_v1 is
  'Returns remaining hold time and same-browser recovery metadata without exposing payment session, token, contact hash, or customer data.';
