-- Run against staging only. Synthetic records and all changes roll back.
begin;
do $$
declare
  provider_id uuid := gen_random_uuid();
  other_provider uuid := gen_random_uuid();
  customer_context jsonb;
  t jsonb;
  replay jsonb;
  v_ticket_id uuid;
  reply_id uuid;
  v integer;
begin
  customer_context:=jsonb_build_object('key','test:'||gen_random_uuid(),'providerId',provider_id,
    'bookingReference','M123456789','serviceDeadline',now()+interval '1 day','paymentDeadline',now()+interval '1 day','refundDeadline',now()+interval '1 day');
  t:=public.support_ticket_operation_v1('customer',customer_context->>'key',provider_id,customer_context,'create',null,
    '{"category":"service","subject":"Invariant test","body":"The meeting was unavailable."}', 'create-test-key-0001');
  v_ticket_id:=(t->>'id')::uuid;
  assert t->>'kind'='customer_complaint';
  assert t->>'assigned_to'='merchant';
  assert jsonb_array_length(t->'messages')=1;
  replay:=public.support_ticket_operation_v1('merchant',provider_id::text,provider_id,null,'list',null,'{"offset":0}',null);
  assert jsonb_array_length(replay->'tickets')=1, 'Merchant inbox listing must execute, including category projection';
  assert replay->'tickets'->0->>'category'='service';
  assert not ((replay->'tickets'->0) ? 'context_key'), 'Inbox must not expose authorization scope';
  replay:=public.support_ticket_operation_v1('merchant',other_provider::text,other_provider,null,'list',null,'{"offset":0}',null);
  assert jsonb_array_length(replay->'tickets')=0, 'Other merchants cannot list the complaint';
  replay:=public.support_ticket_operation_v1('customer',customer_context->>'key',provider_id,customer_context,'list',null,'{"offset":0}',null);
  assert jsonb_array_length(replay->'tickets')=1, 'Customer can list their complaint';
  replay:=public.support_ticket_operation_v1('customer','other',provider_id,customer_context||'{"key":"wrong"}','list',null,'{"offset":0}',null);
  assert jsonb_array_length(replay->'tickets')=0, 'Other customers cannot list the complaint';
  replay:=public.support_ticket_operation_v1('admin','test-admin',null,null,'list',null,'{"offset":0}',null);
  assert exists(select 1 from jsonb_array_elements(replay->'tickets') item where item->>'id'=v_ticket_id::text), 'Staff queue must list complaints';
  replay:=public.support_ticket_operation_v1('customer',customer_context->>'key',provider_id,customer_context,'create',null,
    '{"category":"service","subject":"Invariant test","body":"The meeting was unavailable."}', 'create-test-key-0001');
  assert replay->>'id'=t->>'id';
  assert (select count(*)=1 from public.support_messages where support_messages.ticket_id=v_ticket_id);
  begin
    perform public.support_ticket_operation_v1('customer',customer_context->>'key',provider_id,customer_context,'create',null,
      '{"category":"service","subject":"Changed payload","body":"The meeting was unavailable."}', 'create-test-key-0001');
    raise exception 'Expected idempotency conflict';
  exception when others then assert sqlerrm='IDEMPOTENCY_CONFLICT'; end;
  begin
    perform public.support_ticket_operation_v1('merchant',other_provider::text,other_provider,null,'get',v_ticket_id,'{}',null);
    raise exception 'Expected ownership rejection';
  exception when others then assert sqlerrm='NOT_FOUND'; end;
  begin
    perform public.support_ticket_operation_v1('customer','other',provider_id,customer_context||'{"key":"wrong"}','get',v_ticket_id,'{}',null);
    raise exception 'Expected customer isolation';
  exception when others then assert sqlerrm='NOT_FOUND'; end;
  begin
    perform public.support_ticket_operation_v1('merchant','missing-provider',null,null,'get',v_ticket_id,'{}',null);
    raise exception 'Expected null ownership rejection';
  exception when others then assert sqlerrm='AUTH_REQUIRED'; end;
  t:=public.support_ticket_operation_v1('merchant',provider_id::text,provider_id,null,'reply',v_ticket_id,
    '{"version":1,"body":"We are investigating."}','merchant-reply-00001');
  assert t->>'status'='in_progress';
  assert t->>'acknowledged_at' is not null;
  replay:=public.support_ticket_operation_v1('merchant',provider_id::text,provider_id,null,'reply',v_ticket_id,
    '{"version":1,"body":"We are investigating."}','merchant-reply-00001');
  assert jsonb_array_length(replay->'messages')=2;
  begin
    perform public.support_ticket_operation_v1('merchant',provider_id::text,provider_id,null,'close',v_ticket_id,
      '{"version":1,"body":"We have fixed the meeting."}','merchant-close-old1');
    raise exception 'Expected stale write rejection';
  exception when others then assert sqlerrm='VERSION_CONFLICT'; end;
  t:=public.support_ticket_operation_v1('merchant',provider_id::text,provider_id,null,'close',v_ticket_id,
    '{"version":2,"body":"We have fixed the meeting."}','merchant-close-new1');
  assert t->>'status'='closed';
  begin
    perform public.support_ticket_operation_v1('customer',customer_context->>'key',provider_id,customer_context,'reply',v_ticket_id,
      '{"version":3,"body":"Still broken"}','customer-closedreply1');
    raise exception 'Expected closed reply rejection';
  exception when others then assert sqlerrm='TICKET_CLOSED'; end;
  t:=public.support_ticket_operation_v1('customer',customer_context->>'key',provider_id,customer_context,'reopen',v_ticket_id,
    '{"version":3,"body":"The meeting is still unavailable."}','customer-reopen-001');
  assert t->>'status'='open';
  assert t->>'acknowledged_at' is null;
  update public.support_tickets set response_due_at=now()-interval '1 minute' where id=v_ticket_id;
  perform public.process_support_lifecycle_v1();
  assert (select assigned_to='calup' and escalated_at is not null from public.support_tickets where id=v_ticket_id);
  assert (select count(*)=1 from public.support_events where support_events.ticket_id=v_ticket_id and action='auto_escalate');
  perform public.process_support_lifecycle_v1();
  assert (select count(*)=1 from public.support_events where support_events.ticket_id=v_ticket_id and action='auto_escalate');
  select version into v from public.support_tickets where id=v_ticket_id;
  begin
    perform public.support_ticket_operation_v1('merchant',provider_id::text,provider_id,null,'close',v_ticket_id,
      jsonb_build_object('version',v,'body','Merchant cannot override Calup.'),'merchant-escalated01');
    raise exception 'Expected escalated case ownership';
  exception when others then assert sqlerrm='FORBIDDEN'; end;
  t:=public.support_ticket_operation_v1('admin','test-admin',null,null,'close',v_ticket_id,
    jsonb_build_object('version',v,'body','Calup has reviewed and resolved the issue.'),'admin-close-test001');
  update public.support_tickets set closed_at=now()-interval '4 days' where id=v_ticket_id;
  begin
    perform public.support_ticket_operation_v1('customer',customer_context->>'key',provider_id,customer_context,'reopen',v_ticket_id,
      jsonb_build_object('version',v+1,'body','Please reconsider this issue.'),'customer-late-open1');
    raise exception 'Expected 3-day reopen limit';
  exception when others then assert sqlerrm='REOPEN_WINDOW_CLOSED'; end;
  t:=public.support_ticket_operation_v1('admin','test-admin',null,null,'reopen',v_ticket_id,
    jsonb_build_object('version',v+1,'body','Exceptional reopening after evidence review.'),'admin-exception001');
  assert t->>'status'='open';
  begin
    perform public.support_ticket_operation_v1('customer',customer_context->>'key',provider_id,customer_context||jsonb_build_object('serviceDeadline',now()-interval '1 minute'),'create',null,
      '{"category":"service","subject":"Outside window","body":"The meeting was unavailable."}', 'expired-create-0001');
    raise exception 'Expected 15-day window';
  exception when others then assert sqlerrm='TICKET_WINDOW_CLOSED'; end;
  t:=public.support_ticket_operation_v1('merchant',provider_id::text,provider_id,null,'create',null,
    '{"category":"bug","subject":"Bug report test","body":"Steps: open page. Expected success. Actual error."}', 'merchant-bug-000001');
  reply_id:=(t->>'id')::uuid;
  assert t->>'assigned_to'='calup';
  t:=public.support_ticket_operation_v1('merchant',provider_id::text,provider_id,null,'reply',reply_id,
    '{"version":1,"body":"Additional steps for this bug."}', 'merchant-bug-000001');
  assert jsonb_array_length(t->'messages')=2, 'The same key can be used by different named operations';
  assert t->>'acknowledged_at' is null, 'Merchant cannot acknowledge a Calup-owned report';
  begin
    perform public.support_ticket_operation_v1('merchant',provider_id::text,provider_id,null,'close',reply_id,
      '{"version":2,"body":"Cannot close a Calup-owned report."}', 'merchant-bug-close1');
    raise exception 'Expected Calup ownership';
  exception when others then assert sqlerrm='FORBIDDEN'; end;
  update public.support_tickets set status='closed',closed_at=now()-interval '91 days',legal_hold=true where id=reply_id;
  perform public.process_support_lifecycle_v1();
  assert (select purged_at is null from public.support_tickets where id=reply_id), 'Legal holds preserve case content';
  update public.support_tickets set legal_hold=false where id=reply_id;
  update public.support_tickets set status='closed',closed_at=now()-interval '91 days',financial_retention=true where id=v_ticket_id;
  perform public.process_support_lifecycle_v1();
  assert (select purged_at is not null from public.support_tickets where id=reply_id);
  assert not exists(select 1 from public.support_messages where support_messages.ticket_id=reply_id);
  assert (select purged_at is null from public.support_tickets where id=v_ticket_id), 'Financial cases survive ordinary retention';
  assert not has_table_privilege('anon','public.support_tickets','SELECT');
  assert not has_table_privilege('authenticated','public.support_messages','INSERT');
  assert not has_function_privilege('authenticated','public.support_ticket_operation_v1(text,text,uuid,jsonb,text,uuid,jsonb,text)','EXECUTE');
end;
$$;
rollback;
