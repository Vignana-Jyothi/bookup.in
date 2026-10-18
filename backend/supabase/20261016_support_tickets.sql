-- Server-owned support records. No browser role may read or mutate them directly.
begin;
create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('T' || upper(replace(gen_random_uuid()::text, '-', ''))),
  kind text not null check (kind in ('customer_complaint', 'merchant_support')),
  provider_id uuid not null,
  context_key text not null,
  booking_reference text,
  appointment_id uuid,
  booking_attempt_id uuid,
  payment_order_id uuid,
  payment_resolution_case_id uuid,
  legacy_booking_id uuid,
  category text not null check (category in ('service','meeting','payment','refund','unauthorized_payment','duplicate_charge','bug','account','integration','other')),
  subject text not null check (char_length(subject) between 2 and 160),
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  assigned_to text not null check (assigned_to in ('merchant','calup')),
  escalated_at timestamptz,
  acknowledged_at timestamptz,
  response_due_at timestamptz not null default (now() + interval '48 hours'),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  legal_hold boolean not null default false,
  financial_retention boolean not null default false,
  purged_at timestamptz
);
create index support_tickets_provider on public.support_tickets(provider_id, updated_at desc);
create index support_tickets_context on public.support_tickets(context_key, updated_at desc);
create index support_tickets_deadline on public.support_tickets(response_due_at) where acknowledged_at is null and status in ('open','in_progress');
create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_role text not null check (author_role in ('customer','merchant','admin')),
  body text not null check (char_length(body) between 1 and 6000),
  created_at timestamptz not null default now()
);
create index support_messages_ticket on public.support_messages(ticket_id, created_at, id);
create table public.support_events (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  actor text not null,
  action text not null,
  previous_status text,
  next_status text,
  reason text,
  created_at timestamptz not null default now()
);
create index support_events_ticket on public.support_events(ticket_id, id);
create table public.support_requests (
  actor_key text not null,
  request_key text not null,
  request_hash text not null,
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  primary key (actor_key, request_key)
);
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_events enable row level security;
alter table public.support_requests enable row level security;
revoke all on public.support_tickets, public.support_messages, public.support_events, public.support_requests from anon, authenticated;
grant all on public.support_tickets, public.support_messages, public.support_events, public.support_requests to service_role;
grant usage, select on sequence public.support_events_id_seq to service_role;

-- Only the backend supplies credentials from its HttpOnly session, never from a ticket body.
create function public.support_customer_context_v1(p_kind text, p_reference text, p_phone text, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, app, finance as $$
declare
  a app.appointments%rowtype;
  b app.booking_attempts%rowtype;
  l public.bookings%rowtype;
  p public.providers%rowtype;
  refund_at timestamptz;
begin
  if p_kind = 'reference' then
    select * into a from app.appointments where booking_reference = p_reference and customer_phone = p_phone;
    if not found then return null; end if;
    select * into b from app.booking_attempts where id = a.booking_attempt_id;
  elsif p_kind = 'attempt' then
    select * into b from app.booking_attempts where attempt_token_hash = p_token_hash;
    if not found then return null; end if;
    select * into a from app.appointments where booking_attempt_id = b.id;
  elsif p_kind = 'management' then
    select * into l from public.bookings
      where management_token_hash = p_token_hash or (management_token_hash is null and notes like ('%[mgmt_hash:' || p_token_hash || ']%')) limit 1;
    if not found then return null; end if;
    select * into p from public.providers where id = l.provider_id;
    select max(r.updated_at) into refund_at from public.refunds r where r.booking_id=l.id;
    return jsonb_build_object('key', 'legacy:' || l.id, 'providerId', l.provider_id, 'bookingReference', l.booking_reference, 'legacyBookingId', l.id,
      'serviceDeadline', ((l.booking_date + l.end_time) at time zone coalesce(p.timezone,'Asia/Kolkata')) + interval '15 days',
      'paymentDeadline', l.created_at + interval '15 days', 'refundDeadline', coalesce(refund_at,l.created_at) + interval '15 days');
  else return null;
  end if;
  select max(r.updated_at) into refund_at from finance.refunds_v1 r
    join finance.payment_orders o on o.id = r.payment_order_id where o.booking_attempt_id = b.id;
  return jsonb_build_object('key', 'attempt:' || b.id, 'providerId', b.provider_id, 'bookingReference', a.booking_reference,
    'attemptId',b.id,'appointmentId',a.id,
    'paymentOrderId',(select o.id from finance.payment_orders o where o.booking_attempt_id=b.id),
    'resolutionCaseId',(select c.id from finance.payment_resolution_cases c where c.booking_attempt_id=b.id),
    'serviceDeadline', coalesce(a.ends_at, b.ends_at) + interval '15 days',
    'paymentDeadline', b.created_at + interval '15 days', 'refundDeadline', coalesce(refund_at,b.created_at) + interval '15 days');
end;
$$;

create function public.support_ticket_projection_v1(p_id uuid)
returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select (to_jsonb(t) - 'context_key' - 'provider_id') || jsonb_build_object(
    'messages', coalesce((select jsonb_agg(x order by x.created_at,x.id) from
      (select id,author_role,body,created_at from public.support_messages where ticket_id=t.id order by created_at desc,id desc limit 200) x),'[]'::jsonb),
    'history', coalesce((select jsonb_agg(x order by x.id) from
      (select id,action,previous_status,next_status,reason,created_at from public.support_events where ticket_id=t.id order by id desc limit 100) x),'[]'::jsonb)
  ) from public.support_tickets t where id=p_id;
$$;

-- Each write holds a row lock and commits message, state, audit and retry receipt together.
create function public.support_ticket_operation_v1(p_actor text, p_actor_id text, p_provider_id uuid,
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

create function public.process_support_lifecycle_v1()
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare t public.support_tickets%rowtype; escalations integer:=0; purged integer:=0;
begin
  for t in select * from public.support_tickets where kind='customer_complaint' and assigned_to='merchant' and
    status in ('open','in_progress') and acknowledged_at is null and response_due_at<=now() for update skip locked loop
    update public.support_tickets set assigned_to='calup',escalated_at=now(),version=version+1,updated_at=now() where id=t.id;
    insert into public.support_events(ticket_id,actor,action,previous_status,next_status) values(t.id,'system','auto_escalate',t.status,t.status);
    escalations:=escalations+1;
  end loop;
  for t in select * from public.support_tickets where status in ('closed','resolved') and closed_at<now()-interval '90 days' and
    not financial_retention and not legal_hold and purged_at is null for update skip locked loop
    delete from public.support_messages where ticket_id=t.id;
    update public.support_events set reason=null where ticket_id=t.id;
    update public.support_tickets set subject='Removed after retention period',booking_reference=null,context_key='purged:'||id,purged_at=now(),updated_at=now() where id=t.id;
    insert into public.support_events(ticket_id,actor,action) values(t.id,'system','retention_purge');
    purged:=purged+1;
  end loop;
  return jsonb_build_object('escalated',escalations,'purged',purged);
end;
$$;
revoke all on function public.support_customer_context_v1(text,text,text,text), public.support_ticket_projection_v1(uuid),
  public.support_ticket_operation_v1(text,text,uuid,jsonb,text,uuid,jsonb,text), public.process_support_lifecycle_v1() from public,anon,authenticated;
grant execute on function public.support_customer_context_v1(text,text,text,text), public.support_ticket_projection_v1(uuid),
  public.support_ticket_operation_v1(text,text,uuid,jsonb,text,uuid,jsonb,text), public.process_support_lifecycle_v1() to service_role;
commit;
