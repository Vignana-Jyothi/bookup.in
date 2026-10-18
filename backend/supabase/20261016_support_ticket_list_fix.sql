create or replace function public.support_ticket_operation_v1(p_actor text, p_actor_id text, p_provider_id uuid,
  p_context jsonb, p_action text, p_ticket_id uuid, p_payload jsonb, p_key text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  t public.support_tickets%rowtype;
  existing public.support_requests%rowtype;
  v_actor_key text;
  fingerprint text;
  prior text;
  category text := p_payload->>'category';
  body text := btrim(coalesce(p_payload->>'body',''));
  deadline timestamptz;
  offset_value integer := greatest(0, least(10000, coalesce((p_payload->>'offset')::integer,0)));
begin
  if p_actor is null or p_actor not in ('customer','merchant','admin') or nullif(p_actor_id,'') is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_actor in ('customer','merchant') and p_provider_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_actor = 'customer' and (p_context->>'key' is null or p_provider_id is distinct from (p_context->>'providerId')::uuid) then raise exception 'AUTH_REQUIRED'; end if;
  v_actor_key := p_actor || ':' || p_actor_id || ':' || coalesce(p_provider_id::text,'global') || ':support.' || p_action;
  if p_action='list' then
    return jsonb_build_object('tickets', coalesce((select jsonb_agg(x order by x.updated_at desc,x.id) from (
      select st.id,st.reference,st.kind,st.booking_reference,st.category,st.subject,st.status,st.assigned_to,st.escalated_at,st.acknowledged_at,st.response_due_at,st.closed_at,st.created_at,st.updated_at,st.version
      from public.support_tickets st where st.purged_at is null and
        (p_actor='admin' or (p_actor='merchant' and st.provider_id=p_provider_id) or (p_actor='customer' and st.kind='customer_complaint' and st.context_key=p_context->>'key'))
      order by st.updated_at desc,st.id limit 50 offset offset_value) x),'[]'::jsonb), 'offset',offset_value);
  end if;
  if p_action <> 'create' then
    select * into t from public.support_tickets where id=p_ticket_id for update;
    if not found or t.purged_at is not null or not coalesce((p_actor='admin' or (p_actor='merchant' and t.provider_id=p_provider_id) or
      (p_actor='customer' and t.kind='customer_complaint' and t.context_key=p_context->>'key')),false) then raise exception 'NOT_FOUND'; end if;
    if p_action='get' then return public.support_ticket_projection_v1(t.id); end if;
  end if;
  if p_key is null or char_length(p_key) not between 16 and 128 then raise exception 'VALIDATION_FAILED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor_key,0));
  fingerprint := encode(sha256(convert_to(jsonb_build_object('action',p_action,'ticket',p_ticket_id,'payload',p_payload)::text,'UTF8')),'hex');
  select * into existing from public.support_requests where support_requests.actor_key=v_actor_key and request_key=p_key;
  if found then
    if existing.request_hash<>fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return public.support_ticket_projection_v1(existing.ticket_id);
  end if;
  if p_action='create' then
    if p_actor='admin' then raise exception 'FORBIDDEN'; end if;
    if category not in ('service','meeting','payment','refund','unauthorized_payment','duplicate_charge','bug','account','integration','other') or category is null or
      char_length(btrim(coalesce(p_payload->>'subject',''))) not between 2 and 160 or char_length(body) not between 10 and 6000 then raise exception 'VALIDATION_FAILED'; end if;
    if p_actor='customer' then
      if category in ('bug','account','integration') then raise exception 'VALIDATION_FAILED'; end if;
      deadline := (p_context->>case when category='refund' then 'refundDeadline' when category in ('payment','unauthorized_payment','duplicate_charge') then 'paymentDeadline' else 'serviceDeadline' end)::timestamptz;
      if deadline is null or clock_timestamp()>deadline then raise exception 'TICKET_WINDOW_CLOSED'; end if;
    end if;
    if (select count(*) from public.support_tickets where context_key=case when p_actor='merchant' then 'merchant:'||p_provider_id else p_context->>'key' end and status in ('open','in_progress','resolved'))>=5 then raise exception 'TOO_MANY_OPEN_TICKETS'; end if;
    insert into public.support_tickets(kind,provider_id,context_key,booking_reference,appointment_id,booking_attempt_id,payment_order_id,payment_resolution_case_id,legacy_booking_id,category,subject,assigned_to,financial_retention)
      values (case when p_actor='customer' then 'customer_complaint' else 'merchant_support' end,p_provider_id,
        case when p_actor='customer' then p_context->>'key' else 'merchant:'||p_provider_id end,
        case when p_actor='customer' then p_context->>'bookingReference' else null end,
        (p_context->>'appointmentId')::uuid,(p_context->>'attemptId')::uuid,(p_context->>'paymentOrderId')::uuid,(p_context->>'resolutionCaseId')::uuid,(p_context->>'legacyBookingId')::uuid,
        category,btrim(p_payload->>'subject'),
        case when p_actor='merchant' then 'calup' else 'merchant' end,category in ('payment','refund','unauthorized_payment','duplicate_charge')) returning * into t;
    insert into public.support_messages(ticket_id,author_role,body) values(t.id,p_actor,body);
  else
    prior := t.status;
    if coalesce((p_payload->>'version')::integer,0)<>t.version then raise exception 'VERSION_CONFLICT'; end if;
    if p_action='reply' then
      if t.status in ('resolved','closed') then raise exception 'TICKET_CLOSED'; end if;
      if char_length(body) not between 1 and 6000 then raise exception 'VALIDATION_FAILED'; end if;
      insert into public.support_messages(ticket_id,author_role,body) values(t.id,p_actor,body);
      if (p_actor='merchant' and t.kind='customer_complaint' and t.assigned_to='merchant') or (p_actor='admin' and t.assigned_to='calup') then
        t.acknowledged_at := coalesce(t.acknowledged_at,now()); t.status := 'in_progress';
      end if;
    elsif p_action in ('acknowledge','resolve','close') then
      if p_actor='admin' and t.assigned_to<>'calup' then raise exception 'FORBIDDEN'; end if;
      if p_actor='customer' or (p_actor='merchant' and (t.kind='merchant_support' or t.assigned_to='calup')) then raise exception 'FORBIDDEN'; end if;
      if t.status='closed' or (p_action='acknowledge' and t.status='resolved') then raise exception 'INVALID_TRANSITION'; end if;
      t.acknowledged_at := coalesce(t.acknowledged_at,now());
      if p_action='acknowledge' then t.status:='in_progress'; else
        if char_length(body) not between 10 and 6000 then raise exception 'RESOLUTION_REQUIRED'; end if;
        insert into public.support_messages(ticket_id,author_role,body) values(t.id,p_actor,body);
        t.status:=case when p_action='resolve' then 'resolved' else 'closed' end;
        -- Both resolution and closure start the customer's reopening window.
        t.closed_at:=now();
      end if;
    elsif p_action='reopen' then
      if t.status not in ('closed','resolved') then raise exception 'INVALID_TRANSITION'; end if;
      if p_actor='merchant' and t.kind<>'merchant_support' then raise exception 'FORBIDDEN'; end if;
      if now()>t.closed_at + (case when p_actor='admin' then interval '7 days' else interval '3 days' end) then raise exception 'REOPEN_WINDOW_CLOSED'; end if;
      if char_length(body) not between 10 and 6000 then raise exception 'REASON_REQUIRED'; end if;
      insert into public.support_messages(ticket_id,author_role,body) values(t.id,p_actor,body);
      t.status:='open'; t.closed_at:=null; t.acknowledged_at:=null; t.response_due_at:=now()+interval '48 hours';
    elsif p_action='escalate' then
      if p_actor<>'admin' then raise exception 'FORBIDDEN'; end if;
      if char_length(body) not between 10 and 6000 then raise exception 'REASON_REQUIRED'; end if;
      if t.category not in ('unauthorized_payment','duplicate_charge') and not exists (
        select 1 from finance.payment_orders o where ('attempt:'||o.booking_attempt_id)=t.context_key and o.payment_status='succeeded' and o.fulfilment_status='unfulfilled') and
        not (t.closed_at is not null and now()<=t.closed_at+interval '7 days') and
        not (t.acknowledged_at is null and now()>=t.response_due_at) then raise exception 'ESCALATION_NOT_ELIGIBLE'; end if;
      t.assigned_to:='calup'; t.escalated_at:=coalesce(t.escalated_at,now());
    else raise exception 'VALIDATION_FAILED'; end if;
    t.version:=t.version+1; t.updated_at:=now();
    update public.support_tickets set status=t.status,assigned_to=t.assigned_to,acknowledged_at=t.acknowledged_at,
      closed_at=t.closed_at,response_due_at=t.response_due_at,escalated_at=t.escalated_at,version=t.version,updated_at=t.updated_at where id=t.id;
  end if;
  insert into public.support_events(ticket_id,actor,action,previous_status,next_status,reason)
    values(t.id,v_actor_key,p_action,prior,t.status,case when p_action in ('resolve','close','reopen','escalate') then body else null end);
  insert into public.support_requests(actor_key,request_key,request_hash,ticket_id) values(v_actor_key,p_key,fingerprint,t.id);
  return public.support_ticket_projection_v1(t.id);
end;
$$;

