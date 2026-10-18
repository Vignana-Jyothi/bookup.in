begin;
create or replace function public.operate_commerce_order_v1(p_id uuid,p_action text,p_owner uuid,p_generation integer default null,p_session text default null,p_payment text default null)
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
commit;