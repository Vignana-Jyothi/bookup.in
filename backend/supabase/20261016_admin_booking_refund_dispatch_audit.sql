-- Persist financial dispatch intent and its audit event in the same transaction.
create or replace function public.begin_booking_refund_dispatch_v1(p_id uuid,p_owner uuid,p_generation bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.booking_refund_jobs%rowtype; payment uuid;
begin
  select payment_order_id into payment from public.booking_refund_requests where id=p_id;
  perform 1 from finance.payment_orders where id=payment for update;
  perform 1 from public.booking_refund_requests where id=p_id for update;
  select * into j from public.booking_refund_jobs where request_id=p_id for update;
  if not found or j.status<>'leased' or j.lease_owner is distinct from p_owner or j.lease_generation<>p_generation or j.lease_until<=clock_timestamp() then raise exception 'STALE_LEASE'; end if;
  if j.dispatch_started_at is not null then return false; end if;
  update public.booking_refund_jobs set dispatch_started_at=clock_timestamp() where request_id=p_id;
  update finance.refunds_v1 set status='submitted',updated_at=clock_timestamp() where id=j.refund_id and status<>'succeeded';
  update public.booking_refund_requests set status='processing',version=version+1,updated_at=clock_timestamp() where id=p_id and status<>'refunded';
  insert into ops.audit_events(provider_id,aggregate_type,aggregate_id,action,actor_type,safe_metadata)
    select r.provider_id,'refund',j.refund_id,'booking.refund_dispatch_started','worker',
      jsonb_build_object('requestId',p_id,'generation',p_generation,'gatewayRefundId',j.gateway_refund_id,'environment','sandbox')
    from public.booking_refund_requests r where r.id=p_id;
  return true;
end $$;
