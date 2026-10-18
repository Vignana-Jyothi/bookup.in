-- Preserve requested financial truth until dispatch intent exists.
create or replace function public.finish_booking_refund_v1(p_id uuid,p_owner uuid,p_generation bigint,p_status text,p_safe_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.booking_refund_jobs%rowtype; r public.booking_refund_requests%rowtype; old_status text; state text;
begin
  if p_status not in ('requested','submitted','processing','succeeded','failed','review_required') then raise exception 'INVALID_TRANSITION'; end if;
  select * into r from public.booking_refund_requests where id=p_id;
  perform 1 from finance.payment_orders where id=r.payment_order_id for update;
  select * into r from public.booking_refund_requests where id=p_id for update;
  select * into j from public.booking_refund_jobs where request_id=p_id for update;
  if not found or j.status<>'leased' or j.lease_owner is distinct from p_owner or j.lease_generation<>p_generation or j.lease_until<=clock_timestamp() then return false; end if;
  select status into old_status from finance.refunds_v1 where id=j.refund_id for update;
  if old_status='succeeded' then p_status:='succeeded'; end if;
  if j.attempt_count>=20 and p_status in ('requested','submitted','processing') then p_status:='review_required'; end if;
  state:=case p_status when 'requested' then 'approved' when 'succeeded' then 'refunded' when 'failed' then 'failed' when 'review_required' then 'review_required' else 'processing' end;
  update finance.refunds_v1 set status=p_status,last_safe_error=left(p_safe_error,80),updated_at=clock_timestamp() where id=j.refund_id;
  update public.booking_refund_requests set status=state,version=version+case when status<>state then 1 else 0 end,updated_at=clock_timestamp() where id=p_id;
  update public.booking_refund_jobs set status=case when p_status in ('requested','submitted','processing') then 'waiting' else p_status end,
    due_at=clock_timestamp()+interval '60 seconds',lease_owner=null,lease_until=null,last_safe_error=left(p_safe_error,80),updated_at=clock_timestamp() where request_id=p_id;
  if old_status is distinct from p_status then
    insert into ops.audit_events(provider_id,aggregate_type,aggregate_id,action,actor_type,safe_metadata)
      values(r.provider_id,'refund',j.refund_id,'booking.refund_'||p_status,'cashfree',jsonb_build_object('requestId',r.id,'amountPaise',r.amount_paise,'environment','sandbox'));
    insert into public.support_messages(ticket_id,author_role,body) values(r.ticket_id,'admin',case when p_status='succeeded' then 'Cashfree confirmed the sandbox refund succeeded. Sandbox transactions do not move real money.'
      when p_status='failed' then 'Cashfree refund submission failed. Calup review is required; no successful refund is claimed.'
      when p_status='review_required' then 'Refund outcome needs Calup review. Do not submit a second refund.' else 'The refund is awaiting Cashfree confirmation.' end);
    insert into public.support_events(ticket_id,actor,action) values(r.ticket_id,'cashfree','refund_'||p_status);
  end if;
  if p_status='succeeded' then
    update finance.payment_resolution_cases c set status='resolved',resolved_at=clock_timestamp()
      where c.payment_order_id=r.payment_order_id and c.resolved_at is null
      and (select coalesce(sum(f.amount_paise),0) from finance.refunds_v1 f where f.payment_order_id=r.payment_order_id and f.status='succeeded')
        >=(select amount_paise from finance.payment_orders where id=r.payment_order_id);
  end if;
  return true;
end $$;
