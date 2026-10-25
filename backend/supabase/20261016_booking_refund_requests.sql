begin;
create table public.booking_refund_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('RF'||upper(replace(gen_random_uuid()::text,'-',''))),
  provider_id uuid not null,
  requested_by uuid not null,
  appointment_id uuid not null unique references app.appointments(id) on delete restrict,
  payment_order_id uuid not null unique references finance.payment_orders(id) on delete restrict,
  ticket_id uuid not null unique references public.support_tickets(id) on delete restrict,
  amount_paise bigint not null check(amount_paise>0),
  currency text not null check(currency='INR'),
  reason text not null check(char_length(reason) between 10 and 2000),
  status text not null default 'requested' check(status in ('requested','approved','processing','refunded','rejected','failed','review_required')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);
create table public.booking_refund_request_keys (
  provider_id uuid not null, request_key text not null, request_hash text not null,
  request_id uuid not null references public.booking_refund_requests(id),
  primary key(provider_id,request_key)
);
alter table public.booking_refund_requests enable row level security;
alter table public.booking_refund_request_keys enable row level security;
revoke all on public.booking_refund_requests,public.booking_refund_request_keys from anon,authenticated;
grant all on public.booking_refund_requests,public.booking_refund_request_keys to service_role;

create function public.request_booking_refund_v1(p_provider_id uuid,p_user_id uuid,p_appointment_id uuid,p_reason text,p_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app,finance as $$
declare a app.appointments%rowtype; o finance.payment_orders%rowtype; r public.booking_refund_requests%rowtype;
  retry public.booking_refund_request_keys%rowtype; fingerprint text; remaining bigint; case_id uuid; ticket uuid;
begin
  if p_provider_id is null or p_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 10 and 2000 or char_length(coalesce(p_key,'')) not between 16 and 128 then raise exception 'VALIDATION_FAILED'; end if;
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('appointment',p_appointment_id,'reason',btrim(p_reason))::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('refund-request:'||p_provider_id||':'||p_key,0));
  select * into retry from public.booking_refund_request_keys k where k.provider_id=p_provider_id and k.request_key=p_key;
  if found then
    if retry.request_hash<>fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    select * into r from public.booking_refund_requests where id=retry.request_id;
    return to_jsonb(r)-'requested_by'-'provider_id';
  end if;
  select * into a from app.appointments where id=p_appointment_id and provider_id=p_provider_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into o from finance.payment_orders where id=a.payment_order_id and provider_id=p_provider_id for update;
  if not found or o.purpose<>'service_booking' or o.payment_status<>'succeeded' or o.fulfilment_status<>'fulfilled' then raise exception 'PAYMENT_NOT_REFUNDABLE'; end if;
  select * into r from public.booking_refund_requests where payment_order_id=o.id;
  if found then
    insert into public.booking_refund_request_keys values(p_provider_id,p_key,fingerprint,r.id);
    return to_jsonb(r)-'requested_by'-'provider_id';
  end if;
  if exists(select 1 from finance.refunds_v1 f where f.payment_order_id=o.id and f.status in ('requested','submitted','processing','funding_required','review_required')) then raise exception 'REFUND_ALREADY_IN_PROGRESS'; end if;
  select o.amount_paise-coalesce(sum(f.amount_paise),0) into remaining from finance.refunds_v1 f where f.payment_order_id=o.id and f.status='succeeded';
  if remaining<=0 then raise exception 'ALREADY_REFUNDED'; end if;
  select c.id into case_id from finance.payment_resolution_cases c where c.payment_order_id=o.id;
  insert into public.support_tickets(kind,provider_id,context_key,booking_reference,appointment_id,booking_attempt_id,payment_order_id,payment_resolution_case_id,
    category,subject,assigned_to,financial_retention)
    values('customer_complaint',p_provider_id,'attempt:'||a.booking_attempt_id,a.booking_reference,a.id,a.booking_attempt_id,o.id,case_id,
      'refund','Merchant refund request for '||a.booking_reference,'calup',true) returning id into ticket;
  insert into public.booking_refund_requests(provider_id,requested_by,appointment_id,payment_order_id,ticket_id,amount_paise,currency,reason)
    values(p_provider_id,p_user_id,a.id,o.id,ticket,remaining,o.currency,btrim(p_reason)) returning * into r;
  insert into public.support_messages(ticket_id,author_role,body) values(ticket,'merchant',
    'Refund requested for booking '||a.booking_reference||'. Requested amount: INR '||to_char(remaining::numeric/100,'FM999999999990.00')||
    '. Calup review is pending; no refund or cancellation has been performed. Reason: '||btrim(p_reason));
  insert into public.support_events(ticket_id,actor,action,next_status,reason) values(ticket,'merchant:'||p_user_id,'refund_requested','open',btrim(p_reason));
  insert into public.booking_refund_request_keys values(p_provider_id,p_key,fingerprint,r.id);
  return to_jsonb(r)-'requested_by'-'provider_id';
end;
$$;

create function public.get_booking_refund_request_v1(p_provider_id uuid,p_appointment_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app as $$
begin
  if p_provider_id is null or not exists(select 1 from app.appointments a where a.id=p_appointment_id and a.provider_id=p_provider_id) then raise exception 'NOT_FOUND'; end if;
  return (select to_jsonb(r)-'requested_by'-'provider_id' from public.booking_refund_requests r where r.appointment_id=p_appointment_id and r.provider_id=p_provider_id);
end;
$$;

create or replace function public.support_ticket_projection_v1(p_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select (to_jsonb(t)-'context_key'-'provider_id')||jsonb_build_object(
    'messages',coalesce((select jsonb_agg(x order by x.created_at,x.id) from
      (select id,author_role,body,created_at from public.support_messages where ticket_id=t.id order by created_at desc,id desc limit 200) x),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(x order by x.id) from
      (select id,action,previous_status,next_status,reason,created_at from public.support_events where ticket_id=t.id order by id desc limit 100) x),'[]'::jsonb),
    'refundRequest',(select jsonb_build_object('reference',r.reference,'amountPaise',r.amount_paise,'currency',r.currency,'status',r.status,'createdAt',r.created_at)
      from public.booking_refund_requests r where r.ticket_id=t.id))
  from public.support_tickets t where t.id=p_id;
$$;

create function public.guard_refund_ticket_closure_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.status in ('closed','resolved') and exists(select 1 from public.booking_refund_requests r where r.ticket_id=new.id and r.status not in ('refunded','rejected')) then
    raise exception 'REFUND_REVIEW_PENDING';
  end if;
  return new;
end;
$$;
create trigger guard_refund_ticket_closure before update of status on public.support_tickets for each row execute function public.guard_refund_ticket_closure_v1();
revoke all on function public.request_booking_refund_v1(uuid,uuid,uuid,text,text),public.get_booking_refund_request_v1(uuid,uuid),public.guard_refund_ticket_closure_v1() from public,anon,authenticated;
grant execute on function public.request_booking_refund_v1(uuid,uuid,uuid,text,text),public.get_booking_refund_request_v1(uuid,uuid) to service_role;
commit;
