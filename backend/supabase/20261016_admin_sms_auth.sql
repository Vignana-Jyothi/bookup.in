create table public.admin_sms_challenges (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null unique,
  phone text not null,
  status text not null check (status in ('sending','pending','verifying','verified','failed')),
  provider_ciphertext text,
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  lease_id uuid,
  lease_until timestamptz
);
create table public.admin_sms_grants (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null,
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create table public.admin_sms_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  event text not null check (event in ('send_reserved','send_failed','sent','verify_reserved','verify_failed','verified','revoked')),
  created_at timestamptz not null default now()
);
create index admin_sms_events_user_time on public.admin_sms_events(user_id, created_at);
alter table public.admin_sms_challenges enable row level security;
alter table public.admin_sms_grants enable row level security;
alter table public.admin_sms_events enable row level security;
revoke all on public.admin_sms_challenges, public.admin_sms_grants, public.admin_sms_events from public, anon, authenticated;
grant all on public.admin_sms_challenges, public.admin_sms_grants, public.admin_sms_events to service_role;

create or replace function public.admin_sms_operation_v1(
  p_action text, p_user_id uuid, p_session_id uuid, p_phone text,
  p_id uuid default null, p_ciphertext text default null,
  p_lease_id uuid default null, p_verified boolean default false, p_token_hash text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.admin_sms_challenges%rowtype;
begin
  -- Serializes send/verify operations across every session belonging to this user.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 20261016));
  if not exists (
    select 1 from auth.users u join auth.sessions s on s.user_id=u.id
    where u.id=p_user_id and s.id=p_session_id
      and u.raw_app_meta_data->>'role'='calup_admin'
      and u.raw_app_meta_data->>'admin_phone'=p_phone and p_phone ~ '^\+91[6-9][0-9]{9}$'
      and (u.banned_until is null or u.banned_until <= now())
      and (s.not_after is null or s.not_after > now())
  ) then return jsonb_build_object('error','FORBIDDEN'); end if;

  if p_action='reserve_send' then
    delete from public.admin_sms_events where created_at < now()-interval '90 days';
    delete from public.admin_sms_grants where expires_at < now()-interval '1 day';
    delete from public.admin_sms_challenges where expires_at < now()-interval '1 day';
    if exists (select 1 from public.admin_sms_events where user_id=p_user_id and event='send_reserved' and created_at > now()-interval '60 seconds') then
      return jsonb_build_object('error','COOLDOWN','retryAfter',60);
    end if;
    if (select count(*) from public.admin_sms_events where user_id=p_user_id and event='send_reserved' and created_at > now()-interval '1 hour') >= 5 then
      return jsonb_build_object('error','SEND_LIMIT','retryAfter',3600);
    end if;
    select * into c from public.admin_sms_challenges where session_id=p_session_id for update;
    if c.status='verifying' and c.lease_until > now() then return jsonb_build_object('error','BUSY'); end if;
    if p_id is null then return jsonb_build_object('error','INVALID'); end if;
    delete from public.admin_sms_grants where session_id=p_session_id;
    insert into public.admin_sms_challenges(session_id,user_id,id,phone,status,expires_at)
      values(p_session_id,p_user_id,p_id,p_phone,'sending',now()+interval '10 minutes')
      on conflict(session_id) do update set id=excluded.id,phone=excluded.phone,status='sending',
        sent_at=now(),expires_at=excluded.expires_at,attempts=0,provider_ciphertext=null,lease_id=null,lease_until=null;
    insert into public.admin_sms_events(user_id,session_id,event) values(p_user_id,p_session_id,'send_reserved');
    return jsonb_build_object('id',p_id);
  end if;

  if p_action='revoke' then
    delete from public.admin_sms_grants where session_id=p_session_id;
    delete from public.admin_sms_challenges where session_id=p_session_id;
    insert into public.admin_sms_events(user_id,session_id,event) values(p_user_id,p_session_id,'revoked');
    return jsonb_build_object('ok',true);
  end if;

  select * into c from public.admin_sms_challenges where session_id=p_session_id and id=p_id for update;
  if not found or c.user_id<>p_user_id or c.phone<>p_phone then return jsonb_build_object('error','NO_CHALLENGE'); end if;
  if c.expires_at <= now() then return jsonb_build_object('error','EXPIRED'); end if;

  if p_action='finish_send' then
    if c.status<>'sending' then return jsonb_build_object('error','STALE'); end if;
    update public.admin_sms_challenges set provider_ciphertext=p_ciphertext,
      status=case when p_ciphertext is null then 'failed' else 'pending' end where session_id=p_session_id;
    insert into public.admin_sms_events(user_id,session_id,event) values(p_user_id,p_session_id,case when p_ciphertext is null then 'send_failed' else 'sent' end);
    return jsonb_build_object('ok',p_ciphertext is not null);
  elsif p_action='reserve_verify' then
    if c.status='verifying' and c.lease_until > now() then return jsonb_build_object('error','BUSY'); end if;
    if c.attempts >=5 then return jsonb_build_object('error','ATTEMPTS'); end if;
    if c.status not in ('pending','verifying') or p_lease_id is null then return jsonb_build_object('error','NO_CHALLENGE'); end if;
    update public.admin_sms_challenges set status='verifying',attempts=attempts+1,lease_id=p_lease_id,lease_until=now()+interval '30 seconds' where session_id=p_session_id;
    insert into public.admin_sms_events(user_id,session_id,event) values(p_user_id,p_session_id,'verify_reserved');
    return jsonb_build_object('ciphertext',c.provider_ciphertext);
  elsif p_action='finish_verify' then
    if c.status<>'verifying' or c.lease_id is distinct from p_lease_id or c.lease_until<=now() then return jsonb_build_object('error','STALE'); end if;
    if p_verified and (p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$') then return jsonb_build_object('error','INVALID'); end if;
    update public.admin_sms_challenges set status=case when p_verified then 'verified' when attempts>=5 then 'failed' else 'pending' end,
      lease_id=null,lease_until=null,provider_ciphertext=case when p_verified then null else provider_ciphertext end where session_id=p_session_id;
    if p_verified then
      insert into public.admin_sms_grants(session_id,user_id,phone,token_hash,expires_at)
        values(p_session_id,p_user_id,p_phone,p_token_hash,now()+interval '30 minutes')
        on conflict(session_id) do update set token_hash=excluded.token_hash,phone=excluded.phone,verified_at=now(),expires_at=excluded.expires_at;
    end if;
    insert into public.admin_sms_events(user_id,session_id,event) values(p_user_id,p_session_id,case when p_verified then 'verified' else 'verify_failed' end);
    return jsonb_build_object('verified',p_verified);
  end if;
  return jsonb_build_object('error','INVALID');
end $$;

create or replace function public.verify_calup_admin_sms_session_v1(p_user_id uuid,p_session_id uuid,p_token_hash text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_sms_grants g
      join auth.users u on u.id=g.user_id
      join auth.sessions s on s.id=g.session_id and s.user_id=u.id
    where g.user_id=p_user_id and g.session_id=p_session_id and g.token_hash=p_token_hash and g.expires_at>now()
      and u.raw_app_meta_data->>'role'='calup_admin' and u.raw_app_meta_data->>'admin_phone'=g.phone
      and (u.banned_until is null or u.banned_until<=now()) and (s.not_after is null or s.not_after>now())
  );
$$;
revoke all on function public.admin_sms_operation_v1(text,uuid,uuid,text,uuid,text,uuid,boolean,text) from public,anon,authenticated;
revoke all on function public.verify_calup_admin_sms_session_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.admin_sms_operation_v1(text,uuid,uuid,text,uuid,text,uuid,boolean,text) to service_role;
grant execute on function public.verify_calup_admin_sms_session_v1(uuid,uuid,text) to service_role;
-- Retire the previous native phone-MFA authorization boundary; preserve migration history.
do $$ begin
  if pg_catalog.to_regprocedure('public.verify_calup_admin_session_v1(uuid,uuid)') is not null then
    execute 'revoke all on function public.verify_calup_admin_session_v1(uuid,uuid) from service_role';
  end if;
end $$;
