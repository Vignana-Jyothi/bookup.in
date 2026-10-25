begin;
create table public.commerce_orders (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete restrict,
  contact_id uuid not null references public.commerce_contacts(id) on delete restrict,
  item_id uuid not null references public.merchant_commerce_catalog(id) on delete restrict,
  reservation_id uuid unique references public.commerce_purchase_reservations(id) on delete restrict,
  request_key text not null check(char_length(request_key) between 16 and 128),
  purpose text not null check(purpose in ('marketplace','customer_membership')),
  item_version integer not null, title text not null,
  amount_paise bigint not null check(amount_paise=0 or amount_paise>=100), currency text not null default 'INR' check(currency='INR'),
  duration_days integer check(duration_days between 1 and 366),
  provider_order_id text not null unique, provider_payment_id text,
  checkout_state text not null default 'created' check(checkout_state in ('created','dispatching','ready','unknown','rejected','expired')),
  payment_status text not null default 'pending' check(payment_status in ('pending','succeeded','not_required')),
  fulfilment_status text not null default 'pending' check(fulfilment_status in ('pending','awaiting_delivery','fulfilled','review_required')),
  encrypted_session text,
  expires_at timestamptz not null, gateway_expires_at timestamptz not null,
  lease_owner uuid, lease_generation integer not null default 0, lease_until timestamptz,
  next_check_at timestamptz not null default now(), created_at timestamptz not null default now(), paid_at timestamptz,
  unique(contact_id,request_key), unique(purpose,provider_payment_id),
  check((purpose='marketplace' and reservation_id is not null and duration_days is null) or (purpose='customer_membership' and reservation_id is null and duration_days is not null and amount_paise>0)),
  check((payment_status='not_required')=(amount_paise=0)),
  check(fulfilment_status not in ('fulfilled','awaiting_delivery') or payment_status in ('succeeded','not_required'))
);
create index commerce_orders_reconcile on public.commerce_orders(next_check_at) where payment_status='pending';
create table public.commerce_membership_periods (
  order_id uuid primary key references public.commerce_orders(id) on delete restrict,
  provider_id uuid not null references public.providers(id) on delete restrict,
  contact_id uuid not null references public.commerce_contacts(id) on delete restrict,
  plan_id uuid not null references public.merchant_commerce_catalog(id) on delete restrict,
  starts_at timestamptz not null, ends_at timestamptz not null check(ends_at>starts_at), created_at timestamptz not null default now()
);
create index commerce_membership_owner on public.commerce_membership_periods(contact_id,plan_id,ends_at);
create table public.commerce_payment_reviews (
  order_id uuid primary key references public.commerce_orders(id) on delete restrict,
  reason text not null, status text not null default 'open' check(status in ('open','resolved')),
  created_at timestamptz not null default now()
);
alter table public.commerce_orders enable row level security;
alter table public.commerce_membership_periods enable row level security;
alter table public.commerce_payment_reviews enable row level security;
revoke all on public.commerce_orders,public.commerce_membership_periods,public.commerce_payment_reviews from public,anon,authenticated;
grant all on public.commerce_orders,public.commerce_membership_periods,public.commerce_payment_reviews to service_role;

create function public.begin_commerce_order_v1(p_hash text,p_slug text,p_item uuid,p_version integer,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb; i public.merchant_commerce_catalog%rowtype; o public.commerce_orders%rowtype; r jsonb; ident uuid:=gen_random_uuid();
begin
  if coalesce(char_length(p_key),0) not between 16 and 128 then raise exception 'VALIDATION_FAILED'; end if;
  s:=public.commerce_session_v1(p_hash,p_slug);
  if s is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('commerce-order:'||(s->>'contactId'),0));
  select * into o from public.commerce_orders where contact_id=(s->>'contactId')::uuid and request_key=p_key;
  if found then
    if o.item_id<>p_item or o.item_version<>p_version then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return to_jsonb(o);
  end if;
  select * into i from public.merchant_commerce_catalog where id=p_item and provider_id=(s->>'providerId')::uuid for update;
  if not found or i.status<>'published' or not public.commerce_merchant_active_v1(i.provider_id) then raise exception 'ACCESS_UNAVAILABLE'; end if;
  if i.version<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  if exists(select 1 from public.commerce_orders where contact_id=(s->>'contactId')::uuid and item_id=p_item and payment_status='pending' and gateway_expires_at>clock_timestamp() and checkout_state<>'rejected') then raise exception 'ORDER_ACTIVE'; end if;
  if (select count(*) from public.commerce_orders where contact_id=(s->>'contactId')::uuid and created_at>now()-interval '1 hour')>=10 then raise exception 'ORDER_RATE_LIMIT'; end if;
  if i.kind='product' then
    r:=public.reserve_commerce_purchase_v1(p_hash,p_slug,p_item,p_key);
    if r->>'status'<>'held' or (r->>'expires_at')::timestamptz<=clock_timestamp() or (r->>'product_version')::integer<>i.version then raise exception 'RESERVATION_EXPIRED'; end if;
  end if;
  insert into public.commerce_orders(id,provider_id,contact_id,item_id,reservation_id,request_key,purpose,item_version,title,amount_paise,duration_days,provider_order_id,expires_at,gateway_expires_at,payment_status,fulfilment_status)
    values(ident,i.provider_id,(s->>'contactId')::uuid,i.id,(r->>'id')::uuid,p_key,case when i.kind='product' then 'marketplace' else 'customer_membership' end,
      i.version,i.title,i.price_paise,i.duration_days,(case when i.kind='product' then 'CP' else 'CM' end)||replace(ident::text,'-',''),
      case when i.kind='product' then (r->>'expires_at')::timestamptz else now()+interval '30 minutes' end,now()+interval '30 minutes',
      case when i.price_paise=0 then 'not_required' else 'pending' end,case when i.price_paise=0 then 'awaiting_delivery' else 'pending' end) returning * into o;
  if i.price_paise=0 then update public.commerce_purchase_reservations set status='consumed' where id=o.reservation_id; end if;
  insert into ops.audit_events(provider_id,aggregate_type,aggregate_id,action,actor_type,safe_metadata)
    values(i.provider_id,'commerce_order',ident,'commerce.order_created','customer',jsonb_build_object('purpose',o.purpose,'amountPaise',o.amount_paise));
  return to_jsonb(o);
end $$;

-- All provider I/O follows a committed claim. Reclaimed dispatches use GET, never a second create.
create function public.operate_commerce_order_v1(p_id uuid,p_action text,p_owner uuid,p_generation integer default null,p_session text default null,p_payment text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.commerce_orders%rowtype; i public.merchant_commerce_catalog%rowtype; start_time timestamptz; can_fulfil boolean; old_state text;
begin
  select * into o from public.commerce_orders where id=p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  old_state:=o.checkout_state;
  if p_action='claim' then
    if o.payment_status<>'pending' or o.lease_until>clock_timestamp() then return null; end if;
    update public.commerce_orders set lease_owner=p_owner,lease_generation=lease_generation+1,lease_until=clock_timestamp()+interval '60 seconds',
      checkout_state=case when checkout_state='created' then 'dispatching' else checkout_state end where id=p_id;
    insert into ops.audit_events(provider_id,aggregate_type,aggregate_id,action,actor_type,safe_metadata)
      values(o.provider_id,'commerce_order',o.id,'commerce.order_claimed','system',jsonb_build_object('generation',o.lease_generation+1,'previousState',old_state));
    return to_jsonb(o)||jsonb_build_object('generation',o.lease_generation+1,'dispatch',o.checkout_state='created' and o.expires_at>clock_timestamp());
  end if;
  if o.lease_owner is distinct from p_owner or o.lease_generation is distinct from p_generation or o.lease_until<=clock_timestamp() then raise exception 'STALE_LEASE'; end if;
  if p_action='ready' then
    if coalesce(char_length(p_session),0) not between 1 and 10000 then raise exception 'VALIDATION_FAILED'; end if;
    update public.commerce_orders set encrypted_session=p_session,checkout_state='ready' where id=p_id;
  elsif p_action='success' then
    if coalesce(char_length(p_payment),0) not between 1 and 100 then raise exception 'VALIDATION_FAILED'; end if;
    select * into i from public.merchant_commerce_catalog where id=o.item_id for update;
    can_fulfil:=o.expires_at>clock_timestamp() and o.checkout_state not in ('rejected','expired') and public.commerce_merchant_active_v1(o.provider_id);
    if o.purpose='marketplace' then
      can_fulfil:=can_fulfil and exists(select 1 from public.commerce_access_requests where product_id=o.item_id and contact_id=o.contact_id and status='approved')
        and exists(select 1 from public.commerce_purchase_reservations where id=o.reservation_id and status='held' and expires_at>clock_timestamp());
      update public.commerce_purchase_reservations set status=case when can_fulfil then 'consumed' else 'review_required' end where id=o.reservation_id;
    end if;
    update public.commerce_orders set payment_status='succeeded',provider_payment_id=p_payment,paid_at=clock_timestamp(),encrypted_session=null,
      fulfilment_status=case when not can_fulfil then 'review_required' when o.purpose='marketplace' then 'awaiting_delivery' else 'fulfilled' end where id=p_id;
    if not can_fulfil then
      insert into public.commerce_payment_reviews(order_id,reason) values(p_id,'Verified payment after expiry, lost approval or merchant freeze; manual review/refund required.') on conflict do nothing;
    elsif o.purpose='customer_membership' then
      -- The contact lock serializes renewals across different orders and workers.
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('commerce-membership:'||o.contact_id::text||':'||o.item_id::text,0));
      select greatest(clock_timestamp(),coalesce(max(ends_at),clock_timestamp())) into start_time from public.commerce_membership_periods where contact_id=o.contact_id and plan_id=o.item_id;
      insert into public.commerce_membership_periods(order_id,provider_id,contact_id,plan_id,starts_at,ends_at)
        values(p_id,o.provider_id,o.contact_id,o.item_id,start_time,start_time+make_interval(days=>o.duration_days)) on conflict do nothing;
    end if;
    insert into ops.audit_events(provider_id,aggregate_type,aggregate_id,action,actor_type,safe_metadata)
      values(o.provider_id,'commerce_order',o.id,'commerce.payment_verified','system',jsonb_build_object('fulfilment',case when can_fulfil then 'eligible' else 'review_required' end));
  elsif p_action='rejected' then
    update public.commerce_orders set checkout_state='rejected' where id=p_id;
    update public.commerce_purchase_reservations set status='released' where id=o.reservation_id and status='held';
  elsif p_action='pending' then
    update public.commerce_orders set checkout_state=case when expires_at<=clock_timestamp() then 'expired' when checkout_state='dispatching' then 'unknown' else checkout_state end where id=p_id;
    if o.expires_at<=clock_timestamp() then update public.commerce_purchase_reservations set status='released' where id=o.reservation_id and status='held'; end if;
  else raise exception 'VALIDATION_FAILED'; end if;
  update public.commerce_orders set lease_owner=null,lease_until=null,next_check_at=clock_timestamp()+case when created_at<now()-interval '1 day' then interval '6 hours' else interval '60 seconds' end where id=p_id returning * into o;
  if old_state<>o.checkout_state then
    insert into ops.audit_events(provider_id,aggregate_type,aggregate_id,action,actor_type,safe_metadata)
      values(o.provider_id,'commerce_order',o.id,'commerce.checkout_'||o.checkout_state,'system',jsonb_build_object('generation',o.lease_generation,'previousState',old_state));
  end if;
  return to_jsonb(o);
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('begin_commerce_order_v1','operate_commerce_order_v1') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
commit;
