-- Calup-owned merchant phone verification through 2Factor SMS OTP.
-- Provider session IDs remain private and are accessible only to service_role RPCs.

alter table app.merchant_onboarding
  add column if not exists phone_verification_value text,
  add column if not exists phone_verification_request_id uuid,
  add column if not exists phone_verification_session_id text,
  add column if not exists phone_verification_expires_at timestamptz,
  add column if not exists phone_verification_attempts integer not null default 0,
  add column if not exists phone_verification_sent_at timestamptz,
  add column if not exists phone_verified_at timestamptz;

alter table app.merchant_onboarding
  drop constraint if exists merchant_onboarding_phone_verification_attempts_check;
alter table app.merchant_onboarding
  add constraint merchant_onboarding_phone_verification_attempts_check
  check (phone_verification_attempts between 0 and 5);

alter table app.merchant_onboarding
  drop constraint if exists merchant_onboarding_phone_verification_value_check;
alter table app.merchant_onboarding
  add constraint merchant_onboarding_phone_verification_value_check
  check (phone_verification_value is null or phone_verification_value ~ '^[6-9][0-9]{9}$');

create or replace function public.get_merchant_phone_verification_v1(
  p_provider_id uuid,
  p_phone text
) returns jsonb language sql stable security definer
set search_path = pg_catalog, public, app
as $$
  select jsonb_build_object(
    'verified', phone_verified_at is not null
      and phone_verification_value = regexp_replace(p_phone, '[^0-9]', '', 'g'),
    'sent', phone_verification_session_id is not null
      and phone_verification_expires_at > clock_timestamp()
      and phone_verification_value = regexp_replace(p_phone, '[^0-9]', '', 'g'),
    'expiresAt', case
      when phone_verification_value = regexp_replace(p_phone, '[^0-9]', '', 'g')
        then phone_verification_expires_at
      else null
    end
  )
  from app.merchant_onboarding
  where provider_id = p_provider_id;
$$;

create or replace function public.start_merchant_phone_verification_v1(
  p_provider_id uuid,
  p_phone text,
  p_request_id uuid,
  p_expires_at timestamptz
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_row app.merchant_onboarding%rowtype;
  v_phone text := regexp_replace(p_phone, '[^0-9]', '', 'g');
  v_retry_after integer;
begin
  if v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'invalid Indian mobile number';
  end if;

  insert into app.merchant_onboarding(provider_id)
  values (p_provider_id)
  on conflict (provider_id) do nothing;

  select * into v_row
  from app.merchant_onboarding
  where provider_id = p_provider_id
  for update;

  if v_row.phone_verified_at is not null
     and v_row.phone_verification_value = v_phone then
    return jsonb_build_object('started', false, 'alreadyVerified', true);
  end if;

  if v_row.phone_verification_sent_at is not null
     and v_row.phone_verification_sent_at > clock_timestamp() - interval '60 seconds' then
    v_retry_after := greatest(1, ceil(extract(epoch from (
      v_row.phone_verification_sent_at + interval '60 seconds' - clock_timestamp()
    )))::integer);
    return jsonb_build_object('started', false, 'rateLimited', true, 'retryAfterSeconds', v_retry_after);
  end if;

  update app.merchant_onboarding set
    phone_verification_value = v_phone,
    phone_verification_request_id = p_request_id,
    phone_verification_session_id = null,
    phone_verification_expires_at = p_expires_at,
    phone_verification_attempts = 0,
    phone_verification_sent_at = clock_timestamp(),
    phone_verified_at = null,
    updated_at = clock_timestamp()
  where provider_id = p_provider_id;

  return jsonb_build_object('started', true, 'requestId', p_request_id, 'retryAfterSeconds', 60);
end;
$$;

create or replace function public.complete_merchant_phone_verification_send_v1(
  p_provider_id uuid,
  p_request_id uuid,
  p_session_id text
) returns boolean language sql security definer
set search_path = pg_catalog, public, app
as $$
  update app.merchant_onboarding set
    phone_verification_session_id = p_session_id,
    updated_at = clock_timestamp()
  where provider_id = p_provider_id
    and phone_verification_request_id = p_request_id
    and phone_verified_at is null
    and phone_verification_expires_at > clock_timestamp()
  returning true;
$$;

create or replace function public.cancel_merchant_phone_verification_v1(
  p_provider_id uuid,
  p_request_id uuid
) returns void language sql security definer
set search_path = pg_catalog, public, app
as $$
  update app.merchant_onboarding set
    phone_verification_request_id = null,
    phone_verification_session_id = null,
    phone_verification_expires_at = null,
    phone_verification_attempts = 0,
    updated_at = clock_timestamp()
  where provider_id = p_provider_id
    and phone_verification_request_id = p_request_id
    and phone_verified_at is null;
$$;

create or replace function public.get_merchant_phone_verification_challenge_v1(
  p_provider_id uuid,
  p_phone text
) returns jsonb language sql stable security definer
set search_path = pg_catalog, public, app
as $$
  select jsonb_build_object(
    'verified', phone_verified_at is not null,
    'requestId', phone_verification_request_id,
    'sessionId', phone_verification_session_id,
    'expiresAt', phone_verification_expires_at,
    'attempts', phone_verification_attempts
  )
  from app.merchant_onboarding
  where provider_id = p_provider_id
    and phone_verification_value = regexp_replace(p_phone, '[^0-9]', '', 'g');
$$;

create or replace function public.record_merchant_phone_verification_v1(
  p_provider_id uuid,
  p_phone text,
  p_request_id uuid,
  p_verified boolean
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_row app.merchant_onboarding%rowtype;
  v_phone text := regexp_replace(p_phone, '[^0-9]', '', 'g');
  v_attempts integer;
begin
  select * into v_row
  from app.merchant_onboarding
  where provider_id = p_provider_id
  for update;

  if not found or v_row.phone_verification_value <> v_phone then
    return jsonb_build_object('verified', false, 'reason', 'not_requested');
  end if;
  if v_row.phone_verified_at is not null then
    return jsonb_build_object('verified', true, 'alreadyVerified', true);
  end if;
  if v_row.phone_verification_request_id <> p_request_id
     or v_row.phone_verification_session_id is null then
    return jsonb_build_object('verified', false, 'reason', 'not_requested');
  end if;
  if v_row.phone_verification_attempts >= 5 then
    return jsonb_build_object('verified', false, 'reason', 'attempts_exceeded');
  end if;
  if v_row.phone_verification_expires_at is null
     or v_row.phone_verification_expires_at <= clock_timestamp() then
    return jsonb_build_object('verified', false, 'reason', 'expired');
  end if;

  if not p_verified then
    v_attempts := least(5, v_row.phone_verification_attempts + 1);
    update app.merchant_onboarding set
      phone_verification_attempts = v_attempts,
      updated_at = clock_timestamp()
    where provider_id = p_provider_id;
    return jsonb_build_object(
      'verified', false,
      'reason', case when v_attempts >= 5 then 'attempts_exceeded' else 'invalid_code' end,
      'remainingAttempts', greatest(0, 5 - v_attempts)
    );
  end if;

  update app.merchant_onboarding set
    phone_verified_at = clock_timestamp(),
    phone_verification_request_id = null,
    phone_verification_session_id = null,
    phone_verification_expires_at = null,
    phone_verification_attempts = 0,
    updated_at = clock_timestamp()
  where provider_id = p_provider_id;

  return jsonb_build_object('verified', true, 'phone', v_phone);
end;
$$;

revoke all on function public.get_merchant_phone_verification_v1(uuid, text) from public, anon, authenticated;
revoke all on function public.start_merchant_phone_verification_v1(uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_merchant_phone_verification_send_v1(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.cancel_merchant_phone_verification_v1(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_merchant_phone_verification_challenge_v1(uuid, text) from public, anon, authenticated;
revoke all on function public.record_merchant_phone_verification_v1(uuid, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.get_merchant_phone_verification_v1(uuid, text) to service_role;
grant execute on function public.start_merchant_phone_verification_v1(uuid, text, uuid, timestamptz) to service_role;
grant execute on function public.complete_merchant_phone_verification_send_v1(uuid, uuid, text) to service_role;
grant execute on function public.cancel_merchant_phone_verification_v1(uuid, uuid) to service_role;
grant execute on function public.get_merchant_phone_verification_challenge_v1(uuid, text) to service_role;
grant execute on function public.record_merchant_phone_verification_v1(uuid, text, uuid, boolean) to service_role;
