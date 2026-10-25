begin;
do $$
declare a app.appointments%rowtype; r jsonb; replay jsonb; original_status text; original_refunds bigint; k uuid; other uuid:=gen_random_uuid(); paid bigint;
begin
  select ap.* into a from app.appointments ap join finance.payment_orders o on o.id=ap.payment_order_id
    where o.payment_status='succeeded' and o.fulfilment_status='fulfilled'
      and not exists(select 1 from finance.refunds_v1 f where f.payment_order_id=o.id and f.status not in ('failed','rejected'))
      and not exists(select 1 from public.booking_refund_requests q where q.appointment_id=ap.id)
    limit 1;
  if not found then raise exception 'Staging fixture needs a paid unrefunded appointment'; end if;
  original_status:=a.status;
  select count(*) into original_refunds from finance.refunds_v1;
  select amount_paise into paid from finance.payment_orders where id=a.payment_order_id;
  begin
    insert into finance.refunds_v1(payment_order_id,amount_paise,currency,reason,status,idempotency_key)
      values(a.payment_order_id,paid/2,'INR','Isolated partial refund fixture','succeeded',gen_random_uuid()::text);
    replay:=public.request_booking_refund_v1(a.provider_id,gen_random_uuid(),a.id,'Review remaining amount after partial refund.','partial-refund-test001');
    assert (replay->>'amount_paise')::bigint=paid-paid/2, 'Only the remaining paid balance may be requested';
    raise exception using errcode='P7777',message='rollback partial fixture';
  exception when sqlstate 'P7777' then null; end;
  begin
    insert into finance.refunds_v1(payment_order_id,amount_paise,currency,reason,status,idempotency_key)
      values(a.payment_order_id,paid,'INR','Isolated full refund fixture','succeeded',gen_random_uuid()::text);
    begin
      perform public.request_booking_refund_v1(a.provider_id,gen_random_uuid(),a.id,'Cannot refund a fully refunded order again.','full-refund-test0001');
      raise exception 'Expected fully refunded rejection';
    exception when others then assert sqlerrm='ALREADY_REFUNDED'; end;
    raise exception using errcode='P7777',message='rollback full fixture';
  exception when sqlstate 'P7777' then null; end;
  begin
    insert into finance.refunds_v1(payment_order_id,amount_paise,currency,reason,status,idempotency_key)
      values(a.payment_order_id,paid,'INR','Isolated active refund fixture','submitted',gen_random_uuid()::text);
    begin
      perform public.request_booking_refund_v1(a.provider_id,gen_random_uuid(),a.id,'Cannot duplicate a submitted gateway refund.','active-refund-test001');
      raise exception 'Expected active refund rejection';
    exception when others then assert sqlerrm='REFUND_ALREADY_IN_PROGRESS'; end;
    raise exception using errcode='P7777',message='rollback active fixture';
  exception when sqlstate 'P7777' then null; end;
  r:=public.request_booking_refund_v1(a.provider_id,gen_random_uuid(),a.id,'Merchant requested refund for service issue.','refund-request-test-001');
  assert r->>'status'='requested';
  assert (r->>'amount_paise')::bigint=(select amount_paise from finance.payment_orders where id=a.payment_order_id);
  assert not(r ? 'requested_by');
  replay:=public.request_booking_refund_v1(a.provider_id,gen_random_uuid(),a.id,'Merchant requested refund for service issue.','refund-request-test-001');
  assert replay->>'id'=r->>'id';
  replay:=public.request_booking_refund_v1(a.provider_id,gen_random_uuid(),a.id,'Another request for the same paid booking.','refund-request-test-002');
  assert replay->>'id'=r->>'id';
  assert (select count(*)=1 from public.booking_refund_requests where appointment_id=a.id);
  begin
    perform public.request_booking_refund_v1(a.provider_id,gen_random_uuid(),a.id,'Changed reason for an identical retry key.','refund-request-test-001');
    raise exception 'Expected idempotency conflict';
  exception when others then assert sqlerrm='IDEMPOTENCY_CONFLICT'; end;
  begin
    perform public.request_booking_refund_v1(other,gen_random_uuid(),a.id,'Unauthorized merchant request for a refund.','refund-other-merchant01');
    raise exception 'Expected merchant isolation';
  exception when others then assert sqlerrm='NOT_FOUND'; end;
  begin
    perform public.get_booking_refund_request_v1(other,a.id);
    raise exception 'Expected read isolation';
  exception when others then assert sqlerrm='NOT_FOUND'; end;
  k:=(r->>'ticket_id')::uuid;
  replay:=public.support_ticket_projection_v1(k);
  assert replay->'refundRequest'->>'status'='requested';
  assert replay->>'assigned_to'='calup';
  assert replay->>'context_key' is null;
  begin
    update public.support_tickets set status='closed' where id=k;
    raise exception 'Expected unresolved refund guard';
  exception when others then assert sqlerrm='REFUND_REVIEW_PENDING'; end;
  assert (select status=original_status from app.appointments where id=a.id);
  assert (select payment_status='succeeded' from finance.payment_orders where id=a.payment_order_id);
  assert (select count(*)=original_refunds from finance.refunds_v1);
  assert not has_table_privilege('authenticated','public.booking_refund_requests','UPDATE');
  assert not has_function_privilege('anon','public.request_booking_refund_v1(uuid,uuid,uuid,text,text)','EXECUTE');
end;
$$;
rollback;
