begin;
do $$
declare r public.booking_refund_requests%rowtype; u uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); owner1 uuid:=gen_random_uuid(); owner2 uuid:=gen_random_uuid();
  response jsonb; again jsonb; jobs jsonb; job jsonb; generation1 bigint; generation2 bigint; original_status text; original_allocation text; ledger_count bigint; fixture app.appointments%rowtype;
begin
  if has_function_privilege('authenticated','public.approve_booking_refund_v1(uuid,uuid,uuid,integer,text,text)','execute')
    or has_table_privilege('anon','public.booking_refund_jobs','select') then raise exception 'Financial operations must be service-only'; end if;
  select q.* into r from public.booking_refund_requests q join finance.payment_orders o on o.id=q.payment_order_id
    where q.status='requested' and q.refund_id is null and o.environment='sandbox' and o.paid_at>clock_timestamp()-interval '6 months'
      and not exists(select 1 from finance.refunds_v1 f where f.payment_order_id=o.id and f.status not in ('failed','rejected')) limit 1;
  if not found then
    select a.* into fixture from app.appointments a join finance.payment_orders o on o.id=a.payment_order_id
      where o.environment='sandbox' and o.payment_status='succeeded' and o.fulfilment_status='fulfilled'
        and o.paid_at>clock_timestamp()-interval '6 months'
        and not exists(select 1 from public.booking_refund_requests q where q.appointment_id=a.id)
        and not exists(select 1 from finance.refunds_v1 f where f.payment_order_id=o.id and f.status not in ('failed','rejected')) limit 1;
    if not found then raise exception 'Staging needs a paid unrefunded sandbox appointment'; end if;
    response:=public.request_booking_refund_v1(fixture.provider_id,gen_random_uuid(),fixture.id,'Isolated refund lifecycle test request.','refund-lifecycle-fixture001');
    select * into r from public.booking_refund_requests where id=(response->>'id')::uuid;
  end if;
  select a.status,al.status into original_status,original_allocation from app.appointments a join app.slot_allocations al on al.id=a.allocation_id where a.id=r.appointment_id;
  select count(*) into ledger_count from finance.refunds_v1 where payment_order_id=r.payment_order_id;
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role,created_at,updated_at)
    values(u,u::text||'@refund-test.invalid','{"role":"calup_admin","admin_phone":"+919000000001"}','{}','authenticated','authenticated',now(),now());
  insert into auth.sessions(id,user_id,aal,created_at,updated_at) values(s,u,'aal1',now(),now());
  insert into public.admin_sms_grants(session_id,user_id,phone,token_hash,verified_at,expires_at)
    values(s,u,'+919000000001',repeat('a',64),now()-interval '6 minutes',now()+interval '30 minutes');
  begin
    perform public.approve_booking_refund_v1(r.id,u,s,r.version,'Test approval with stale verification.','refund-stale-test001');
    raise exception 'Expected fresh verification denial';
  exception when others then assert sqlerrm='FRESH_AUTH_REQUIRED',sqlerrm; end;
  update public.admin_sms_grants set verified_at=clock_timestamp() where session_id=s;
  begin
    perform public.approve_booking_refund_v1(r.id,u,s,r.version+1,'Test approval with obsolete request version.','refund-version-test001');
    raise exception 'Expected version conflict';
  exception when others then assert sqlerrm='VERSION_CONFLICT',sqlerrm; end;
  begin
    insert into finance.refunds_v1(payment_order_id,amount_paise,currency,reason,status,idempotency_key)
      values(r.payment_order_id,r.amount_paise,'INR','Isolated balance reservation fixture','processing',gen_random_uuid()::text);
    begin
      perform public.approve_booking_refund_v1(r.id,u,s,r.version,'Test refund balance protection.','refund-balance-test001');
      raise exception 'Expected balance conflict';
    exception when others then assert sqlerrm='REFUND_BALANCE_CHANGED',sqlerrm; end;
    raise exception using errcode='P7777',message='rollback reserved balance fixture';
  exception when sqlstate 'P7777' then null; end;
  response:=public.approve_booking_refund_v1(r.id,u,s,r.version,'Approved after isolated test evidence review.','refund-approval-test001');
  assert response->>'status'='approved';
  assert (select status from app.appointments where id=r.appointment_id)='cancelled', 'Approval cancels appointment';
  assert (select al.status from app.appointments a join app.slot_allocations al on al.id=a.allocation_id where a.id=r.appointment_id)='released', 'Approval releases only its allocation';
  assert (select x->>'refundStatus' from jsonb_array_elements(public.get_merchant_cashfree_appointments_v1(r.provider_id)) x where x->>'id'=r.appointment_id::text)='approved';
  if (select meeting_type='online' from app.appointments where id=r.appointment_id) then
    jobs:=public.claim_refund_calendar_cleanup_v1('cleanup-test');
    select value into job from jsonb_array_elements(jobs) where value->>'id'=r.appointment_id::text;
    -- Other due cleanup work may precede this fixture; isolate it inside the rollback.
    if job is null then
      update public.refund_calendar_cleanup_jobs set due_at=clock_timestamp()-interval '1 day' where appointment_id=r.appointment_id;
      jobs:=public.claim_refund_calendar_cleanup_v1('cleanup-test');
      select value into job from jsonb_array_elements(jobs) where value->>'id'=r.appointment_id::text;
    end if;
    assert job is not null;
    assert not public.finish_refund_calendar_cleanup_v1(r.appointment_id,'wrong-owner',(job->>'generation')::bigint,true);
    assert public.finish_refund_calendar_cleanup_v1(r.appointment_id,'cleanup-test',(job->>'generation')::bigint,true);
    assert not public.complete_google_calendar_sync_v1(r.appointment_id,'stale-creator',0,true,'calup-late-test-event','https://meet.google.com/test');
    assert (select status from public.refund_calendar_cleanup_jobs where appointment_id=r.appointment_id)='queued', 'Late event creation requeues cleanup';
    assert (select meet_link from app.appointments where id=r.appointment_id) is null;
  end if;
  again:=public.approve_booking_refund_v1(r.id,u,s,r.version,'Approved after isolated test evidence review.','refund-approval-test001');
  assert again->>'gatewayRefundId'=response->>'gatewayRefundId';
  assert (select count(*) from finance.refunds_v1 where payment_order_id=r.payment_order_id)=ledger_count+1;
  begin
    perform public.approve_booking_refund_v1(r.id,u,s,r.version,'Changed payload on the same approval identity.','refund-approval-test001');
    raise exception 'Expected idempotency conflict';
  exception when others then assert sqlerrm='IDEMPOTENCY_CONFLICT',sqlerrm; end;
  jobs:=public.claim_booking_refunds_v1(owner1,25);
  select value into job from jsonb_array_elements(jobs) where value->>'requestId'=r.id::text;
  assert job is not null;
  generation1:=(job->>'generation')::bigint;
  update public.booking_refund_jobs set lease_until=clock_timestamp()-interval '1 second' where request_id=r.id;
  jobs:=public.claim_booking_refunds_v1(owner2,25);
  select value into job from jsonb_array_elements(jobs) where value->>'requestId'=r.id::text;
  generation2:=(job->>'generation')::bigint;
  assert generation2>generation1;
  assert not public.finish_booking_refund_v1(r.id,owner1,generation1,'succeeded');
  assert public.begin_booking_refund_dispatch_v1(r.id,owner2,generation2);
  assert not public.begin_booking_refund_dispatch_v1(r.id,owner2,generation2), 'Only one POST dispatch intent';
  assert public.finish_booking_refund_v1(r.id,owner2,generation2,'processing');
  assert (select status from app.appointments where id=r.appointment_id)='cancelled';
  assert (select x->>'refundStatus' from jsonb_array_elements(public.get_merchant_cashfree_appointments_v1(r.provider_id)) x where x->>'id'=r.appointment_id::text)='processing';
  assert public.wake_booking_refund_v1(p_gateway_id=>response->>'gatewayRefundId',p_order_id=>(select provider_order_id from finance.payment_orders where id=r.payment_order_id),p_payload_hash=>repeat('f',64));
  assert not public.wake_booking_refund_v1(p_gateway_id=>response->>'gatewayRefundId',p_order_id=>(select provider_order_id from finance.payment_orders where id=r.payment_order_id),p_payload_hash=>repeat('f',64)), 'Duplicate callbacks cannot requeue twice';
  assert public.wake_booking_refund_v1(p_id=>r.id);
  jobs:=public.claim_booking_refunds_v1(owner2,25);
  select value into job from jsonb_array_elements(jobs) where value->>'requestId'=r.id::text;
  generation2:=(job->>'generation')::bigint;
  assert job->>'dispatchStarted' is not null;
  assert public.finish_booking_refund_v1(r.id,owner2,generation2,'succeeded');
  assert (select status from public.booking_refund_requests where id=r.id)='refunded';
  assert (select status from finance.refunds_v1 where id=(select refund_id from public.booking_refund_requests where id=r.id))='succeeded';
  update public.booking_refund_jobs set status='leased',lease_owner=owner2,lease_until=clock_timestamp()+interval '1 minute' where request_id=r.id;
  assert public.finish_booking_refund_v1(r.id,owner2,generation2,'failed'), 'Late failure cannot downgrade verified success';
  assert (select status from public.booking_refund_requests where id=r.id)='refunded';
  update public.support_tickets set status='resolved' where id=r.ticket_id;
  assert (select status from app.appointments where id=r.appointment_id)='cancelled', 'Late callbacks never restore appointment';
  assert (select al.status from app.appointments a join app.slot_allocations al on al.id=a.allocation_id where a.id=r.appointment_id)='released', 'Late callbacks never reserve the slot again';
  assert (select x->>'refundStatus' from jsonb_array_elements(public.get_merchant_cashfree_appointments_v1(r.provider_id)) x where x->>'id'=r.appointment_id::text)='refunded';
end $$;
rollback;
