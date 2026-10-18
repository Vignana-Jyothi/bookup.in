-- Calup-owned merchant email verification. This is deliberately independent
-- from Supabase Auth's optional "Confirm email" switch.

alter table app.merchant_onboarding
  add column if not exists email_verification_value text,
  add column if not exists email_verification_hash text,
  add column if not exists email_verification_expires_at timestamptz,
  add column if not exists email_verification_attempts integer not null default 0,
  add column if not exists email_verification_sent_at timestamptz,
  add column if not exists email_verified_at timestamptz;

alter table app.merchant_onboarding
  drop constraint if exists merchant_onboarding_email_verification_attempts_check;
alter table app.merchant_onboarding
  add constraint merchant_onboarding_email_verification_attempts_check
  check (email_verification_attempts between 0 and 5);

create or replace function public.get_merchant_email_verification_v1(
  p_provider_id uuid,
  p_email text
) returns jsonb language sql stable security definer
set search_path = pg_catalog, public, app
as $$
  select jsonb_build_object(
    'email', lower(btrim(p_email)),
    'verified', email_verified_at is not null
      and lower(email_verification_value) = lower(btrim(p_email)),
    'sent', email_verification_sent_at is not null
      and lower(email_verification_value) = lower(btrim(p_email)),
    'expiresAt', case
      when lower(email_verification_value) = lower(btrim(p_email))
        then email_verification_expires_at
      else null
    end
  )
  from app.merchant_onboarding
  where provider_id = p_provider_id;
$$;

create or replace function public.start_merchant_email_verification_v1(
  p_provider_id uuid,
  p_email text,
  p_code_hash text,
  p_expires_at timestamptz
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_row app.merchant_onboarding%rowtype;
  v_email text := lower(btrim(p_email));
  v_retry_after integer;
begin
  insert into app.merchant_onboarding(provider_id)
  values (p_provider_id)
  on conflict (provider_id) do nothing;

  select * into v_row
  from app.merchant_onboarding
  where provider_id = p_provider_id
  for update;

  if v_row.email_verified_at is not null
     and lower(v_row.email_verification_value) = v_email then
    return jsonb_build_object('started', false, 'alreadyVerified', true);
  end if;

  if v_row.email_verification_sent_at is not null
     and v_row.email_verification_sent_at > clock_timestamp() - interval '60 seconds' then
    v_retry_after := greatest(1, ceil(extract(epoch from (
      v_row.email_verification_sent_at + interval '60 seconds' - clock_timestamp()
    )))::integer);
    return jsonb_build_object('started', false, 'rateLimited', true, 'retryAfterSeconds', v_retry_after);
  end if;

  update app.merchant_onboarding set
    email_verification_value = v_email,
    email_verification_hash = p_code_hash,
    email_verification_expires_at = p_expires_at,
    email_verification_attempts = 0,
    email_verification_sent_at = clock_timestamp(),
    email_verified_at = null,
    updated_at = clock_timestamp()
  where provider_id = p_provider_id;

  return jsonb_build_object('started', true, 'expiresAt', p_expires_at, 'retryAfterSeconds', 60);
end;
$$;

create or replace function public.cancel_merchant_email_verification_v1(
  p_provider_id uuid,
  p_code_hash text
) returns void language sql security definer
set search_path = pg_catalog, public, app
as $$
  update app.merchant_onboarding set
    email_verification_hash = null,
    email_verification_expires_at = null,
    email_verification_attempts = 0,
    email_verification_sent_at = null,
    updated_at = clock_timestamp()
  where provider_id = p_provider_id
    and email_verification_hash = p_code_hash
    and email_verified_at is null;
$$;

create or replace function public.verify_merchant_email_code_v1(
  p_provider_id uuid,
  p_email text,
  p_code_hash text
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_row app.merchant_onboarding%rowtype;
  v_email text := lower(btrim(p_email));
  v_attempts integer;
begin
  select * into v_row
  from app.merchant_onboarding
  where provider_id = p_provider_id
  for update;

  if not found or lower(coalesce(v_row.email_verification_value, '')) <> v_email then
    return jsonb_build_object('verified', false, 'reason', 'not_requested');
  end if;
  if v_row.email_verified_at is not null then
    return jsonb_build_object('verified', true, 'alreadyVerified', true);
  end if;
  if v_row.email_verification_attempts >= 5 then
    return jsonb_build_object('verified', false, 'reason', 'attempts_exceeded');
  end if;
  if v_row.email_verification_expires_at is null
     or v_row.email_verification_expires_at <= clock_timestamp() then
    return jsonb_build_object('verified', false, 'reason', 'expired');
  end if;

  if v_row.email_verification_hash <> p_code_hash then
    v_attempts := least(5, v_row.email_verification_attempts + 1);
    update app.merchant_onboarding set
      email_verification_attempts = v_attempts,
      updated_at = clock_timestamp()
    where provider_id = p_provider_id;
    return jsonb_build_object(
      'verified', false,
      'reason', case when v_attempts >= 5 then 'attempts_exceeded' else 'invalid_code' end,
      'remainingAttempts', greatest(0, 5 - v_attempts)
    );
  end if;

  update app.merchant_onboarding set
    email_verified_at = clock_timestamp(),
    email_verification_hash = null,
    email_verification_expires_at = null,
    email_verification_attempts = 0,
    updated_at = clock_timestamp()
  where provider_id = p_provider_id;

  return jsonb_build_object('verified', true, 'email', v_email);
end;
$$;

revoke all on function public.get_merchant_email_verification_v1(uuid, text) from public, anon, authenticated;
revoke all on function public.start_merchant_email_verification_v1(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.cancel_merchant_email_verification_v1(uuid, text) from public, anon, authenticated;
revoke all on function public.verify_merchant_email_code_v1(uuid, text, text) from public, anon, authenticated;
grant execute on function public.get_merchant_email_verification_v1(uuid, text) to service_role;
grant execute on function public.start_merchant_email_verification_v1(uuid, text, text, timestamptz) to service_role;
grant execute on function public.cancel_merchant_email_verification_v1(uuid, text) to service_role;
grant execute on function public.verify_merchant_email_code_v1(uuid, text, text) to service_role;
