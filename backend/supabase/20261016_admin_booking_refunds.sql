begin;
alter table public.booking_refund_requests add column refund_id uuid unique references finance.refunds_v1(id);
create table public.booking_refund_jobs (
  request_id uuid primary key references public.booking_refund_requests(id),
  refund_id uuid not null unique references finance.refunds_v1(id),
  gateway_refund_id text not null unique,
  approved_by uuid not null,
  approval_reason text not null,
  status text not null default 'queued' check(status in ('queued','leased','waiting','succeeded','failed','review_required')),
  due_at timestamptz not null default now(),
  lease_owner uuid, lease_generation bigint not null default 0, lease_until timestamptz,
  attempt_count integer not null default 0,
  dispatch_started_at timestamptz,
  last_safe_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.booking_refund_decisions (
  actor_id uuid not null, request_id uuid not null references public.booking_refund_requests(id),
  request_key text not null, fingerprint text not null, reason text not null, created_at timestamptz not null default now(),
  primary key(actor_id,request_id,request_key)
);
create table public.booking_refund_webhook_events (
  payload_hash text primary key check(payload_hash ~ '^[a-f0-9]{64}$'),
  gateway_refund_id text not null, provider_order_id text not null,
  received_at timestamptz not null default now()
);
alter table public.booking_refund_jobs enable row level security;
alter table public.booking_refund_decisions enable row level security;
alter table public.booking_refund_webhook_events enable row level security;
revoke all on public.booking_refund_jobs,public.booking_refund_decisions,public.booking_refund_webhook_events from public,anon,authenticated;
grant all on public.booking_refund_jobs,public.booking_refund_decisions,public.booking_refund_webhook_events to service_role;

create function public.admin_booking_refund_projection_v1(p_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',r.id,'reference',r.reference,'status',r.status,'version',r.version,'amountPaise',r.amount_paise,'currency',r.currency,
    'reason',r.reason,'bookingReference',a.booking_reference,'appointmentStatus',a.status,'merchant',coalesce(p.business_name,p.name),
    'environment',o.environment,'paymentStatus',o.payment_status,'fulfilmentStatus',o.fulfilment_status,'refundStatus',f.status,
    'gatewayRefundId',j.gateway_refund_id,'jobStatus',j.status,'updatedAt',r.updated_at,
    'refundableBalancePaise',o.amount_paise-coalesce((select sum(x.amount_paise) from finance.refunds_v1 x where x.payment_order_id=o.id and x.status not in ('failed','rejected')),0))
  from public.booking_refund_requests r join finance.payment_orders o on o.id=r.payment_order_id
  join public.providers p on p.id=r.provider_id join app.appointments a on a.id=r.appointment_id
  left join finance.refunds_v1 f on f.id=r.refund_id left join public.booking_refund_jobs j on j.request_id=r.id where r.id=p_id;
$$;

create function public.approve_booking_refund_v1(p_id uuid,p_actor_id uuid,p_session_id uuid,p_version integer,p_reason text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.booking_refund_requests%rowtype; o finance.payment_orders%rowtype; fingerprint text; old_fingerprint text; reserved bigint; f uuid; gateway_id text;
begin
  if char_length(btrim(coalesce(p_reason,''))) not between 10 and 2000 or char_length(coalesce(p_key,'')) not between 16 and 128 then raise exception 'VALIDATION_FAILED'; end if;
  if not exists(select 1 from public.admin_sms_grants g join auth.users u on u.id=g.user_id join auth.sessions s on s.id=g.session_id and s.user_id=u.id
    where g.user_id=p_actor_id and g.session_id=p_session_id and g.expires_at>clock_timestamp()
      and u.raw_app_meta_data->>'role'='calup_admin' and u.raw_app_meta_data->>'admin_phone'=g.phone
      and (u.banned_until is null or u.banned_until<=clock_timestamp()) and (s.not_after is null or s.not_after>clock_timestamp())) then raise exception 'FORBIDDEN'; end if;
  fingerprint:=encode(extensions.digest(jsonb_build_object('version',p_version,'reason',btrim(p_reason))::text,'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin-refund:'||p_actor_id||':'||p_id||':'||p_key,0));
  select d.fingerprint into old_fingerprint from public.booking_refund_decisions d where actor_id=p_actor_id and request_id=p_id and request_key=p_key;
  if found then
    if old_fingerprint<>fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return public.admin_booking_refund_projection_v1(p_id);
  end if;
  select * into r from public.booking_refund_requests where id=p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into o from finance.payment_orders where id=r.payment_order_id for update;
  select * into r from public.booking_refund_requests where id=p_id for update;
  if r.refund_id is not null then return public.admin_booking_refund_projection_v1(p_id); end if;
  if r.status<>'requested' then raise exception 'INVALID_TRANSITION'; end if;
  if p_version is null or r.version<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  if not exists(select 1 from public.admin_sms_grants where user_id=p_actor_id and session_id=p_session_id and verified_at>clock_timestamp()-interval '5 minutes') then raise exception 'FRESH_AUTH_REQUIRED'; end if;
  if o.environment<>'sandbox' or o.gateway_account<>'calup_primary' or o.payment_path<>'cashfree' or o.purpose<>'service_booking'
    or o.payment_status<>'succeeded' or o.fulfilment_status<>'fulfilled' or o.provider_order_id is null
    or o.paid_at is null or o.paid_at<clock_timestamp()-interval '6 months' then raise exception 'PAYMENT_NOT_REFUNDABLE'; end if;
  select coalesce(sum(x.amount_paise),0) into reserved from finance.refunds_v1 x where x.payment_order_id=o.id and x.status not in ('failed','rejected');
  if r.amount_paise>o.amount_paise-reserved then raise exception 'REFUND_BALANCE_CHANGED'; end if;
  f:=gen_random_uuid(); gateway_id:='CR'||replace(f::text,'-','');
  insert into finance.refunds_v1(id,payment_order_id,amount_paise,currency,reason,status,provider_refund_id,idempotency_key)
    values(f,o.id,r.amount_paise,r.currency,btrim(p_reason),'requested',gateway_id,f::text);
  insert into public.booking_refund_jobs(request_id,refund_id,gateway_refund_id,approved_by,approval_reason) values(r.id,f,gateway_id,p_actor_id,btrim(p_reason));
  update public.booking_refund_requests set refund_id=f,status='approved',version=version+1,updated_at=clock_timestamp() where id=r.id;
  insert into public.booking_refund_decisions values(p_actor_id,r.id,p_key,fingerprint,btrim(p_reason),clock_timestamp());
  insert into ops.audit_events(provider_id,aggregate_type,aggregate_id,action,actor_type,safe_metadata)
    values(r.provider_id,'refund',f,'booking.refund_approved','admin',jsonb_build_object('actorId',p_actor_id,'requestId',r.id,'amountPaise',r.amount_paise,'reason',btrim(p_reason),'environment',o.environment));
  insert into public.support_messages(ticket_id,author_role,body) values(r.ticket_id,'admin','Calup approved the refund for Cashfree submission. It is not refunded until Cashfree confirms success. Appointment changes are handled separately.');
  insert into public.support_events(ticket_id,actor,action,reason) values(r.ticket_id,'admin:'||p_actor_id,'refund_approved',btrim(p_reason));
  return public.admin_booking_refund_projection_v1(r.id);
end $$;

create function public.claim_booking_refunds_v1(p_owner uuid,p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  with picked as (select j.request_id from public.booking_refund_jobs j join finance.refunds_v1 f on f.id=j.refund_id join finance.payment_orders o on o.id=f.payment_order_id
    where o.environment='sandbox' and o.gateway_account='calup_primary' and j.due_at<=clock_timestamp()
      and (j.status in ('queued','waiting') or (j.status='leased' and j.lease_until<=clock_timestamp()))
    order by j.due_at limit greatest(1,least(p_limit,25)) for update of j skip locked),
  claimed as (update public.booking_refund_jobs j set status='leased',lease_owner=p_owner,lease_generation=j.lease_generation+1,
    lease_until=clock_timestamp()+interval '2 minutes',attempt_count=j.attempt_count+1,updated_at=clock_timestamp()
    from picked where j.request_id=picked.request_id returning j.*)
  select coalesce(jsonb_agg(jsonb_build_object('requestId',j.request_id,'refundId',j.refund_id,'gatewayRefundId',j.gateway_refund_id,'generation',j.lease_generation,
    'dispatchStarted',j.dispatch_started_at,'orderId',o.provider_order_id,'environment',o.environment,'gatewayAccount',o.gateway_account,
    'amountPaise',f.amount_paise,'currency',f.currency,'paymentAmountPaise',o.amount_paise,
    'providerPaymentId',(select x.provider_payment_id from finance.payment_attempts x where x.payment_order_id=o.id and x.status='succeeded' order by x.paid_at,x.id limit 1))),'[]'::jsonb)
  into result from claimed j join finance.refunds_v1 f on f.id=j.refund_id join finance.payment_orders o on o.id=f.payment_order_id;
  return result;
end $$;

create function public.begin_booking_refund_dispatch_v1(p_id uuid,p_owner uuid,p_generation bigint)
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

create function public.finish_booking_refund_v1(p_id uuid,p_owner uuid,p_generation bigint,p_status text,p_safe_error text default null)
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

create function public.wake_booking_refund_v1(p_id uuid default null,p_gateway_id text default null,p_order_id text default null,p_payload_hash text default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_payload_hash is not null then
    insert into public.booking_refund_webhook_events(payload_hash,gateway_refund_id,provider_order_id) values(p_payload_hash,left(p_gateway_id,100),left(p_order_id,256)) on conflict do nothing;
    if not found then return false; end if;
  end if;
  update public.booking_refund_jobs j set status=case when j.status='leased' and j.lease_until>clock_timestamp() then j.status else 'waiting' end,
    due_at=clock_timestamp(),dispatch_started_at=case when p_payload_hash is not null then coalesce(j.dispatch_started_at,clock_timestamp()) else j.dispatch_started_at end,
    attempt_count=case when j.status in ('failed','review_required') then 0 else j.attempt_count end
  from finance.refunds_v1 f join finance.payment_orders o on o.id=f.payment_order_id
  where f.id=j.refund_id and f.status<>'succeeded' and o.environment='sandbox' and o.gateway_account='calup_primary'
    and ((p_id is not null and j.request_id=p_id and j.dispatch_started_at is not null) or (p_gateway_id is not null and j.gateway_refund_id=p_gateway_id and o.provider_order_id=p_order_id));
  return found;
end $$;

revoke all on function public.admin_booking_refund_projection_v1(uuid),public.approve_booking_refund_v1(uuid,uuid,uuid,integer,text,text),public.claim_booking_refunds_v1(uuid,integer),
  public.begin_booking_refund_dispatch_v1(uuid,uuid,bigint),public.finish_booking_refund_v1(uuid,uuid,bigint,text,text),public.wake_booking_refund_v1(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_booking_refund_projection_v1(uuid),public.approve_booking_refund_v1(uuid,uuid,uuid,integer,text,text),public.claim_booking_refunds_v1(uuid,integer),
  public.begin_booking_refund_dispatch_v1(uuid,uuid,bigint),public.finish_booking_refund_v1(uuid,uuid,bigint,text,text),public.wake_booking_refund_v1(uuid,text,text,text) to service_role;
commit;
