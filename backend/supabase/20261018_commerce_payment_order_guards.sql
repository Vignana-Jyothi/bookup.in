begin;
create or replace function public.begin_commerce_order_v1(p_hash text,p_slug text,p_item uuid,p_version integer,p_key text)
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
create or replace function public.operate_commerce_order_v1(p_id uuid,p_action text,p_owner uuid,p_generation integer default null,p_session text default null,p_payment text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.commerce_orders%rowtype; i public.merchant_commerce_catalog%rowtype; start_time timestamptz; can_fulfil boolean;
begin
  select * into o from public.commerce_orders where id=p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_action='claim' then
    if o.payment_status<>'pending' or o.lease_until>clock_timestamp() then return null; end if;
    update public.commerce_orders set lease_owner=p_owner,lease_generation=lease_generation+1,lease_until=clock_timestamp()+interval '60 seconds',
      checkout_state=case when checkout_state='created' then 'dispatching' else checkout_state end where id=p_id;
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
  return to_jsonb(o);
end $$;
commit;