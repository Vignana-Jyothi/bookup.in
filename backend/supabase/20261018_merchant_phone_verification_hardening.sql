-- Additive rollout: old pending challenges expire normally; verified contacts stay verified.
alter table app.merchant_onboarding
  add column if not exists phone_verification_ciphertext text,
  add column if not exists phone_verification_cipher_request_id uuid,
  add column if not exists phone_verification_lease_id uuid,
  add column if not exists phone_verification_lease_until timestamptz;

create or replace function public.merchant_phone_operation_v2(
  p_provider_id uuid, p_phone text, p_action text,
  p_request_id uuid default null, p_ciphertext text default null,
  p_lease_id uuid default null, p_verified boolean default false,
  p_expired boolean default false
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
declare
  r app.merchant_onboarding%rowtype;
  started jsonb;
  v_phone text := regexp_replace(p_phone, '[^0-9]', '', 'g');
begin
  if v_phone is null or v_phone !~ '^[6-9][0-9]{9}$' then
    return jsonb_build_object('reason','invalid_phone');
  end if;
  if p_action = 'begin_send' then
    if p_request_id is null then return jsonb_build_object('reason','invalid_request'); end if;
    started := public.start_merchant_phone_verification_v1(
      p_provider_id,v_phone,p_request_id,clock_timestamp()+interval '10 minutes');
    if (started->>'started')::boolean then
      update app.merchant_onboarding set phone_verification_ciphertext=null,
        phone_verification_cipher_request_id=null,phone_verification_lease_id=null,
        phone_verification_lease_until=null where provider_id=p_provider_id;
    end if;
    return started;
  end if;

  select * into r from app.merchant_onboarding where provider_id=p_provider_id for update;
  if not found or r.phone_verification_value is distinct from v_phone then
    return jsonb_build_object('verified',false,'reason','not_requested');
  end if;
  if p_action='reserve_verify' and r.phone_verified_at is not null then
    return jsonb_build_object('verified',true);
  end if;
  if p_action in ('finish_send','cancel','finish_verify') and
    (p_request_id is null or r.phone_verification_request_id is distinct from p_request_id) then
    return jsonb_build_object('verified',false,'reason','stale');
  end if;
  if r.phone_verified_at is not null then return jsonb_build_object('verified',false,'reason','stale'); end if;

  if p_action='finish_send' then
    if r.phone_verification_expires_at is null or r.phone_verification_expires_at<=clock_timestamp()
      or p_ciphertext is null or p_ciphertext !~ '^[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]+$'
      or length(p_ciphertext)>1100 then return jsonb_build_object('sent',false,'reason','invalid_challenge'); end if;
    update app.merchant_onboarding set phone_verification_ciphertext=p_ciphertext,
      phone_verification_cipher_request_id=p_request_id,phone_verification_session_id=null,
      updated_at=clock_timestamp() where provider_id=p_provider_id;
    return jsonb_build_object('sent',true);
  end if;

  if p_action='cancel' then
    update app.merchant_onboarding set phone_verification_request_id=null,
      phone_verification_session_id=null,phone_verification_ciphertext=null,
      phone_verification_cipher_request_id=null,phone_verification_lease_id=null,
      phone_verification_lease_until=null,phone_verification_expires_at=null,
      updated_at=clock_timestamp() where provider_id=p_provider_id;
    return jsonb_build_object('cancelled',true);
  end if;

  if p_action='reserve_verify' then
    if p_lease_id is null then return jsonb_build_object('reason','invalid_request'); end if;
    if r.phone_verification_request_id is null or (r.phone_verification_session_id is null and
      (r.phone_verification_ciphertext is null or r.phone_verification_cipher_request_id is distinct from r.phone_verification_request_id)) then
      return jsonb_build_object('verified',false,'reason','not_requested');
    end if;
    if r.phone_verification_expires_at is null or r.phone_verification_expires_at<=clock_timestamp() then
      return jsonb_build_object('verified',false,'reason','expired'); end if;
    if r.phone_verification_lease_until>clock_timestamp() then
      return jsonb_build_object('verified',false,'reason','busy'); end if;
    if r.phone_verification_attempts>=5 then
      return jsonb_build_object('verified',false,'reason','attempts_exceeded'); end if;
    update app.merchant_onboarding set phone_verification_attempts=phone_verification_attempts+1,
      phone_verification_lease_id=p_lease_id,phone_verification_lease_until=clock_timestamp()+interval '30 seconds',
      updated_at=clock_timestamp() where provider_id=p_provider_id;
    return jsonb_build_object('reserved',true,'requestId',r.phone_verification_request_id,
      'ciphertext',case when r.phone_verification_session_id is null then r.phone_verification_ciphertext else null end,
      'legacySession',r.phone_verification_session_id);
  end if;

  if p_action='finish_verify' then
    if p_lease_id is null or r.phone_verification_lease_id is distinct from p_lease_id
      or r.phone_verification_lease_until is null or r.phone_verification_lease_until<=clock_timestamp() then
      return jsonb_build_object('verified',false,'reason','stale'); end if;
    if p_expired is true or r.phone_verification_expires_at is null or r.phone_verification_expires_at<=clock_timestamp() then
      update app.merchant_onboarding set phone_verification_session_id=null,
        phone_verification_ciphertext=null,phone_verification_cipher_request_id=null,
        phone_verification_lease_id=null,phone_verification_lease_until=null,
        phone_verification_expires_at=clock_timestamp(),updated_at=clock_timestamp() where provider_id=p_provider_id;
      return jsonb_build_object('verified',false,'reason','expired');
    end if;
    if p_verified is true then
      update app.merchant_onboarding set phone_verified_at=clock_timestamp(),
        phone_verification_request_id=null,phone_verification_session_id=null,
        phone_verification_ciphertext=null,phone_verification_cipher_request_id=null,
        phone_verification_lease_id=null,phone_verification_lease_until=null,
        phone_verification_expires_at=null,updated_at=clock_timestamp() where provider_id=p_provider_id;
      return jsonb_build_object('verified',true);
    end if;
    update app.merchant_onboarding set phone_verification_lease_id=null,
      phone_verification_lease_until=null,updated_at=clock_timestamp() where provider_id=p_provider_id;
    return jsonb_build_object('verified',false,'reason',case when r.phone_verification_attempts>=5 then 'attempts_exceeded' else 'invalid_code' end,
      'remainingAttempts',greatest(0,5-r.phone_verification_attempts));
  end if;
  return jsonb_build_object('verified',false,'reason','invalid_action');
end;
$$;

create or replace function public.get_merchant_phone_verification_v1(p_provider_id uuid,p_phone text)
returns jsonb language sql stable security definer
set search_path = pg_catalog, public, app
as $$
  select jsonb_build_object('verified',phone_verified_at is not null
    and phone_verification_value=regexp_replace(p_phone,'[^0-9]','','g'),
    'sent',(phone_verification_session_id is not null or
      (phone_verification_ciphertext is not null and phone_verification_cipher_request_id=phone_verification_request_id))
      and phone_verification_expires_at>clock_timestamp()
      and phone_verification_value=regexp_replace(p_phone,'[^0-9]','','g'),
    'expiresAt',case when phone_verification_value=regexp_replace(p_phone,'[^0-9]','','g') then phone_verification_expires_at else null end)
  from app.merchant_onboarding where provider_id=p_provider_id;
$$;

revoke all on function public.merchant_phone_operation_v2(uuid,text,text,uuid,text,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.merchant_phone_operation_v2(uuid,text,text,uuid,text,uuid,boolean,boolean) to service_role;
