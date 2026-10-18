begin;
alter table public.merchant_commerce_catalog drop constraint merchant_commerce_catalog_status_check;
alter table public.merchant_commerce_catalog add constraint merchant_commerce_catalog_status_check check(status in ('draft','archived','published'));

create table public.commerce_contacts (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete restrict,
  phone text not null check(phone~'^[6-9][0-9]{9}$'),
  created_at timestamptz not null default now(), unique(provider_id,phone)
);
create table public.commerce_otp_challenges (
  id uuid primary key default gen_random_uuid(), provider_id uuid not null references public.providers(id) on delete restrict,
  phone text not null, booking_id uuid references app.appointments(id) on delete restrict, ip_hash text not null,
  status text not null default 'reserved' check(status in ('reserved','sent','failed','verified')),
  encrypted_session text, attempts integer not null default 0,
  lease_owner uuid, lease_until timestamptz,
  created_at timestamptz not null default now(), expires_at timestamptz not null default (now()+interval '10 minutes')
);
create index commerce_otp_phone_time on public.commerce_otp_challenges(phone,created_at desc);
create index commerce_otp_ip_time on public.commerce_otp_challenges(ip_hash,created_at desc);
create table public.commerce_customer_sessions (
  token_hash text primary key check(token_hash~'^[a-f0-9]{64}$'),
  contact_id uuid not null references public.commerce_contacts(id) on delete restrict,
  booking_id uuid references app.appointments(id) on delete restrict,
  expires_at timestamptz not null default (now()+interval '30 minutes')
);
create table public.commerce_access_requests (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.merchant_commerce_catalog(id) on delete restrict,
  contact_id uuid not null references public.commerce_contacts(id) on delete restrict,
  booking_id uuid not null references app.appointments(id) on delete restrict,
  status text not null default 'pending' check(status in ('pending','approved','rejected','revoked')),
  version integer not null default 1, reason text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(product_id,contact_id)
);
create table public.commerce_purchase_reservations (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.merchant_commerce_catalog(id) on delete restrict,
  contact_id uuid not null references public.commerce_contacts(id) on delete restrict,
  request_key text not null, product_version integer not null, amount_paise bigint not null,
  status text not null default 'held' check(status in ('held','consumed','released','review_required')),
  expires_at timestamptz not null default (now()+interval '15 minutes'), created_at timestamptz not null default now(),
  unique(contact_id,request_key)
);
create index commerce_reservation_allowance on public.commerce_purchase_reservations(product_id,contact_id,status);
do $$ declare t text; begin
  foreach t in array array['commerce_contacts','commerce_otp_challenges','commerce_customer_sessions','commerce_access_requests','commerce_purchase_reservations'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;

create function public.commerce_merchant_active_v1(p_provider uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from app.merchant_entitlements where provider_id=p_provider and status in ('active','grace')
    and starts_at<=now() and grace_ends_at>now());
$$;
create function public.publish_commerce_item_v1(p_provider uuid,p_id uuid,p_version integer,p_publish boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.merchant_commerce_catalog%rowtype;
begin
  select * into item from public.merchant_commerce_catalog where id=p_id and provider_id=p_provider for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if item.version<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  if p_publish then
    if not public.commerce_merchant_active_v1(p_provider) then raise exception 'MERCHANT_INACTIVE'; end if;
    if item.status<>'draft' then raise exception 'INVALID_TRANSITION'; end if;
    if item.kind='product' and not exists(select 1 from public.merchant_commerce_assets where product_id=p_id and status='ready') then raise exception 'CONTENT_REQUIRED'; end if;
  end if;
  update public.merchant_commerce_catalog set status=case when p_publish then 'published' else 'draft' end,version=version+1,updated_at=now()
    where id=p_id returning * into item;
  insert into ops.audit_events(provider_id,aggregate_type,aggregate_id,action,actor_type,safe_metadata)
    values(p_provider,'commerce_item',p_id,case when p_publish then 'commerce.published' else 'commerce.unpublished' end,'merchant',jsonb_build_object('version',item.version));
  return to_jsonb(item)-'provider_id';
end $$;

-- Published settings must be explicitly unpublished before editing.
do $$ declare definition text; patched text; begin
  definition:=pg_get_functiondef('public.save_merchant_commerce_item_v1(uuid,uuid,text,integer,text,text,bigint,integer,integer,text,text)'::regprocedure);
  patched:=replace(definition,'if item.version<>p_version', 'if item.status=''published'' then raise exception ''ITEM_PUBLISHED''; end if; if item.version<>p_version');
  if patched=definition then raise exception 'Catalog save shape changed'; end if;
  execute patched;
end $$;

create function public.begin_commerce_otp_v1(p_slug text,p_phone text,p_booking_reference text,p_ip_hash text)
returns uuid language plpgsql security definer set search_path='' as $$
declare provider uuid; booking uuid; challenge uuid;
begin
  if p_phone !~ '^[6-9][0-9]{9}$' or p_ip_hash !~ '^[a-f0-9]{64}$' then raise exception 'VALIDATION_FAILED'; end if;
  select id into provider from public.providers where slug=p_slug;
  if not found or not public.commerce_merchant_active_v1(provider) then raise exception 'ACCESS_UNAVAILABLE'; end if;
  if p_booking_reference is not null then
    select a.id into booking from app.appointments a join finance.payment_orders o on o.id=a.payment_order_id
      where a.provider_id=provider and a.booking_reference=p_booking_reference
        and right(regexp_replace(a.customer_phone,'[^0-9]','','g'),10)=p_phone
        and a.ends_at<=now() and a.status in ('confirmed','completed','outcome_pending')
        and o.payment_status='succeeded' and o.fulfilment_status='fulfilled';
    if not found then raise exception 'BOOKING_NOT_ELIGIBLE'; end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('commerce-otp-phone:'||p_phone,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('commerce-otp-ip:'||p_ip_hash,0));
  if exists(select 1 from public.commerce_otp_challenges where phone=p_phone and created_at>now()-interval '60 seconds')
    or (select count(*) from public.commerce_otp_challenges where phone=p_phone and created_at>now()-interval '1 hour')>=5
    or (select count(*) from public.commerce_otp_challenges where ip_hash=p_ip_hash and created_at>now()-interval '1 hour')>=20 then raise exception 'OTP_RATE_LIMIT'; end if;
  insert into public.commerce_otp_challenges(provider_id,phone,booking_id,ip_hash) values(provider,p_phone,booking,p_ip_hash) returning id into challenge;
  return challenge;
end $$;

create function public.operate_commerce_otp_v1(p_id uuid,p_action text,p_owner uuid default null,p_session text default null,p_token_hash text default null,p_verified boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.commerce_otp_challenges%rowtype; contact uuid;
begin
  select * into c from public.commerce_otp_challenges where id=p_id for update;
  if not found or c.expires_at<=clock_timestamp() then raise exception 'OTP_EXPIRED'; end if;
  if p_action='sent' and c.status='reserved' then
    if p_session is null or char_length(p_session)>2000 then raise exception 'VALIDATION_FAILED'; end if;
    update public.commerce_otp_challenges set encrypted_session=p_session,status='sent' where id=p_id;
    return '{}'::jsonb;
  elsif p_action='failed' and c.status='reserved' then
    update public.commerce_otp_challenges set status='failed' where id=p_id;
    return '{}'::jsonb;
  elsif p_action='reserve_verify' and c.status='sent' and c.attempts<5 and p_owner is not null then
    if c.lease_until>clock_timestamp() then raise exception 'OTP_BUSY'; end if;
    update public.commerce_otp_challenges set attempts=attempts+1,lease_owner=p_owner,lease_until=clock_timestamp()+interval '30 seconds' where id=p_id;
    return jsonb_build_object('encryptedSession',c.encrypted_session);
  elsif p_action='finish_verify' and c.status='sent' and c.lease_owner=p_owner and c.lease_until>clock_timestamp() then
    update public.commerce_otp_challenges set lease_owner=null,lease_until=null where id=p_id;
    if not p_verified then return jsonb_build_object('verified',false); end if;
    if p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'VALIDATION_FAILED'; end if;
    insert into public.commerce_contacts(provider_id,phone) values(c.provider_id,c.phone)
      on conflict(provider_id,phone) do update set phone=excluded.phone returning id into contact;
    insert into public.commerce_customer_sessions(token_hash,contact_id,booking_id) values(p_token_hash,contact,c.booking_id);
    update public.commerce_otp_challenges set status='verified',encrypted_session=null where id=p_id;
    return jsonb_build_object('verified',true);
  end if;
  raise exception 'OTP_INVALID';
end $$;

create function public.commerce_session_v1(p_hash text,p_slug text)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('contactId',c.id,'providerId',c.provider_id,'bookingId',s.booking_id,'maskedPhone','******'||right(c.phone,4))
    from public.commerce_customer_sessions s join public.commerce_contacts c on c.id=s.contact_id
    join public.providers p on p.id=c.provider_id where s.token_hash=p_hash and s.expires_at>now() and p.slug=p_slug;
$$;
create function public.request_commerce_access_v1(p_hash text,p_slug text,p_product uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare session jsonb; item public.merchant_commerce_catalog%rowtype; r public.commerce_access_requests%rowtype;
begin
  session:=public.commerce_session_v1(p_hash,p_slug);
  if session is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into item from public.merchant_commerce_catalog where id=p_product and provider_id=(session->>'providerId')::uuid and kind='product' and status='published';
  if not found or not public.commerce_merchant_active_v1(item.provider_id) then raise exception 'ACCESS_UNAVAILABLE'; end if;
  if session->>'bookingId' is null or not exists(select 1 from app.appointments a join finance.payment_orders o on o.id=a.payment_order_id
    where a.id=(session->>'bookingId')::uuid and a.provider_id=item.provider_id and a.ends_at<=now()
      and a.status in ('confirmed','completed','outcome_pending') and o.payment_status='succeeded' and o.fulfilment_status='fulfilled'
      and right(regexp_replace(a.customer_phone,'[^0-9]','','g'),10)=(select phone from public.commerce_contacts where id=(session->>'contactId')::uuid)) then raise exception 'BOOKING_NOT_ELIGIBLE'; end if;
  insert into public.commerce_access_requests(product_id,contact_id,booking_id) values(p_product,(session->>'contactId')::uuid,(session->>'bookingId')::uuid)
    on conflict(product_id,contact_id) do nothing;
  select * into r from public.commerce_access_requests where product_id=p_product and contact_id=(session->>'contactId')::uuid;
  return jsonb_build_object('id',r.id,'status',r.status,'version',r.version,'productId',r.product_id);
end $$;
create function public.decide_commerce_access_v1(p_provider uuid,p_id uuid,p_version integer,p_status text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.commerce_access_requests%rowtype; item public.merchant_commerce_catalog%rowtype;
begin
  select i.* into item from public.merchant_commerce_catalog i join public.commerce_access_requests q on q.product_id=i.id where q.id=p_id and i.provider_id=p_provider for update of i;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into r from public.commerce_access_requests where id=p_id for update;
  if r.version<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  if coalesce(p_status,'') not in ('approved','rejected','revoked') or char_length(btrim(coalesce(p_reason,''))) not between 10 and 1000 then raise exception 'VALIDATION_FAILED'; end if;
  if not ((r.status='pending' and p_status in ('approved','rejected')) or (r.status='approved' and p_status='revoked')) then raise exception 'INVALID_TRANSITION'; end if;
  if p_status='approved' and (item.status<>'published' or not public.commerce_merchant_active_v1(p_provider)) then raise exception 'ACCESS_UNAVAILABLE'; end if;
  if p_status='approved' and not exists(select 1 from app.appointments a join finance.payment_orders o on o.id=a.payment_order_id
    where a.id=r.booking_id and a.provider_id=p_provider and a.ends_at<=now() and a.status in ('confirmed','completed','outcome_pending')
      and o.payment_status='succeeded' and o.fulfilment_status='fulfilled') then raise exception 'BOOKING_NOT_ELIGIBLE'; end if;
  update public.commerce_access_requests set status=p_status,reason=btrim(p_reason),version=version+1,updated_at=now() where id=p_id returning * into r;
  insert into ops.audit_events(provider_id,aggregate_type,aggregate_id,action,actor_type,safe_metadata)
    values(p_provider,'commerce_access',p_id,'commerce.access_'||p_status,'merchant',jsonb_build_object('productId',r.product_id,'version',r.version,'attendanceConfirmed',p_status='approved'));
  return jsonb_build_object('id',r.id,'status',r.status,'version',r.version);
end $$;

create function public.list_commerce_access_v1(p_provider uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
    select r.id,r.product_id,r.status,r.version,r.reason,r.created_at,i.title,a.booking_reference,a.customer_name,
      '******'||right(c.phone,4) as masked_phone
    from public.commerce_access_requests r join public.merchant_commerce_catalog i on i.id=r.product_id
      join public.commerce_contacts c on c.id=r.contact_id join app.appointments a on a.id=r.booking_id
    where i.provider_id=p_provider order by (r.status='pending') desc,r.created_at desc limit 100
  ) x;
$$;

-- Internal-only reservation primitive; public checkout remains disabled until payment/delivery are connected.
create function public.reserve_commerce_purchase_v1(p_hash text,p_slug text,p_product uuid,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare session jsonb; item public.merchant_commerce_catalog%rowtype; r public.commerce_purchase_reservations%rowtype; used bigint;
begin
  if char_length(p_key) not between 16 and 128 then raise exception 'VALIDATION_FAILED'; end if;
  session:=public.commerce_session_v1(p_hash,p_slug);
  if session is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into item from public.merchant_commerce_catalog where id=p_product and provider_id=(session->>'providerId')::uuid and kind='product' for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into r from public.commerce_purchase_reservations where contact_id=(session->>'contactId')::uuid and request_key=p_key;
  if found then
    if r.product_id<>p_product then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return to_jsonb(r)-'contact_id';
  end if;
  if item.status<>'published' or not public.commerce_merchant_active_v1(item.provider_id) or not exists(
    select 1 from public.commerce_access_requests where product_id=p_product and contact_id=(session->>'contactId')::uuid and status='approved') then raise exception 'APPROVAL_REQUIRED'; end if;
  select count(*) into used from public.commerce_purchase_reservations where product_id=p_product and contact_id=(session->>'contactId')::uuid
    and (status in ('consumed','review_required') or (status='held' and expires_at>now()));
  if used>=item.purchase_limit then raise exception 'PURCHASE_LIMIT'; end if;
  insert into public.commerce_purchase_reservations(product_id,contact_id,request_key,product_version,amount_paise)
    values(p_product,(session->>'contactId')::uuid,p_key,item.version,item.price_paise) returning * into r;
  return to_jsonb(r)-'contact_id';
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('commerce_merchant_active_v1','publish_commerce_item_v1','begin_commerce_otp_v1','operate_commerce_otp_v1','commerce_session_v1','request_commerce_access_v1','decide_commerce_access_v1','list_commerce_access_v1','reserve_commerce_purchase_v1') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
commit;
