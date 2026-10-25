-- Calup Cashfree v1: additive sandbox payment vertical slice.
-- Apply to staging before setting CASHFREE_V1_ENABLED=true.

create extension if not exists btree_gist;

create schema if not exists app;
create schema if not exists finance;
create schema if not exists ops;

revoke all on schema app, finance, ops from public, anon, authenticated;
grant usage on schema app, finance, ops to service_role;

create table if not exists app.booking_attempts (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  customer_name text not null check (char_length(customer_name) between 2 and 120),
  customer_phone text not null check (customer_phone ~ '^[6-9][0-9]{9}$'),
  customer_email text,
  customer_contact_hash text not null check (char_length(customer_contact_hash) = 64),
  verification_grant_id uuid,
  attempt_token_hash text not null check (char_length(attempt_token_hash) = 64),
  booking_date date not null,
  start_time time not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  hold_expires_at timestamptz not null,
  status text not null default 'hold_active'
    check (status in ('hold_active', 'manual_review', 'confirmed', 'expired', 'released')),
  price_paise bigint not null check (price_paise > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  meeting_type text not null check (meeting_type in ('online', 'in-person')),
  policy_accepted_at timestamptz,
  idempotency_key text not null,
  request_hash text not null check (char_length(request_hash) = 64),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  expired_at timestamptz,
  released_at timestamptz,
  unique (provider_id, idempotency_key),
  check (ends_at > starts_at),
  check (hold_expires_at > created_at)
);

create unique index if not exists booking_attempts_one_active_contact
  on app.booking_attempts(provider_id, customer_contact_hash)
  where status in ('hold_active', 'manual_review');

create index if not exists booking_attempts_hold_expiry
  on app.booking_attempts(hold_expires_at)
  where status = 'hold_active';
create index if not exists booking_attempts_service_id on app.booking_attempts(service_id);

create table if not exists app.slot_allocations (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete restrict,
  attempt_id uuid not null unique references app.booking_attempts(id) on delete restrict,
  starts_at timestamptz not null,
  occupancy_ends_at timestamptz not null,
  hold_expires_at timestamptz not null,
  status text not null default 'held'
    check (status in ('held', 'manual_review', 'reserved', 'expired', 'released')),
  release_reason text,
  created_at timestamptz not null default now(),
  reserved_at timestamptz,
  expired_at timestamptz,
  released_at timestamptz,
  check (occupancy_ends_at > starts_at)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'slot_allocations_no_overlap_v1') then
    alter table app.slot_allocations
      add constraint slot_allocations_no_overlap_v1
      exclude using gist (
        provider_id with =,
        tstzrange(starts_at, occupancy_ends_at, '[)') with &&
      ) where (status in ('held', 'manual_review', 'reserved'));
  end if;
end $$;

create index if not exists slot_allocations_expiry
  on app.slot_allocations(hold_expires_at)
  where status = 'held';

create table if not exists finance.payment_orders (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete restrict,
  booking_attempt_id uuid not null unique references app.booking_attempts(id) on delete restrict,
  purpose text not null default 'service_booking' check (purpose in ('service_booking', 'subscription')),
  payment_path text not null default 'cashfree' check (payment_path in ('cashfree', 'manual')),
  environment text not null check (environment in ('sandbox', 'production')),
  gateway_account text not null,
  amount_paise bigint not null check (amount_paise > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  payment_status text not null default 'created'
    check (payment_status in ('created', 'creation_unknown', 'pending', 'creation_failed', 'closed_unpaid', 'succeeded')),
  fulfilment_status text not null default 'not_ready'
    check (fulfilment_status in ('not_ready', 'fulfilled', 'unfulfilled', 'not_applicable')),
  provider_order_id text,
  payment_session_id text,
  last_safe_error_code text,
  paid_at timestamptz,
  late_success_at timestamptz,
  next_reconcile_at timestamptz not null default now(),
  reconcile_attempt_count integer not null default 0 check (reconcile_attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (environment, gateway_account, provider_order_id)
);

create index if not exists payment_orders_reconciliation
  on finance.payment_orders(payment_status, next_reconcile_at)
  where payment_status in ('creation_unknown', 'pending', 'closed_unpaid');
create index if not exists payment_orders_provider_id on finance.payment_orders(provider_id);

create table if not exists finance.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  payment_order_id uuid not null references finance.payment_orders(id) on delete restrict,
  provider_payment_id text not null,
  status text not null check (status in ('created', 'pending', 'succeeded', 'failed')),
  amount_paise bigint check (amount_paise >= 0),
  currency text check (currency is null or currency = 'INR'),
  paid_at timestamptz,
  source text not null,
  created_at timestamptz not null default now(),
  unique (payment_order_id, provider_payment_id)
);

create table if not exists finance.gateway_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'cashfree' check (provider = 'cashfree'),
  environment text not null check (environment in ('sandbox', 'production')),
  gateway_account text not null,
  event_key text not null,
  event_type text not null,
  provider_order_id text not null,
  provider_payment_id text,
  payload_hash text not null check (char_length(payload_hash) = 64),
  webhook_timestamp text not null,
  signature_valid boolean not null default true,
  status text not null default 'received'
    check (status in ('received', 'processed', 'rejected', 'review_required')),
  safe_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, environment, gateway_account, event_key)
);

create table if not exists finance.payment_resolution_cases (
  id uuid primary key default gen_random_uuid(),
  payment_order_id uuid not null unique references finance.payment_orders(id) on delete restrict,
  booking_attempt_id uuid not null references app.booking_attempts(id) on delete restrict,
  lost_allocation_id uuid references app.slot_allocations(id) on delete restrict,
  provider_id uuid not null references public.providers(id) on delete restrict,
  status text not null default 'open'
    check (status in ('open', 'refund_required', 'refund_in_progress', 'escalated', 'resolved')),
  reason text not null,
  review_due_at timestamptz not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists payment_resolution_cases_attempt_id on finance.payment_resolution_cases(booking_attempt_id);
create index if not exists payment_resolution_cases_allocation_id on finance.payment_resolution_cases(lost_allocation_id);
create index if not exists payment_resolution_cases_provider_id on finance.payment_resolution_cases(provider_id);

create table if not exists finance.refunds_v1 (
  id uuid primary key default gen_random_uuid(),
  payment_order_id uuid not null references finance.payment_orders(id) on delete restrict,
  resolution_case_id uuid references finance.payment_resolution_cases(id) on delete restrict,
  amount_paise bigint not null check (amount_paise > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  reason text not null,
  status text not null default 'requested'
    check (status in ('requested', 'submitted', 'processing', 'succeeded', 'failed', 'funding_required', 'review_required', 'rejected')),
  provider_refund_id text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists refunds_v1_payment_order_id on finance.refunds_v1(payment_order_id);
create index if not exists refunds_v1_resolution_case_id on finance.refunds_v1(resolution_case_id);

create table if not exists app.appointments (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  booking_attempt_id uuid not null unique references app.booking_attempts(id) on delete restrict,
  allocation_id uuid not null unique references app.slot_allocations(id) on delete restrict,
  payment_order_id uuid not null unique references finance.payment_orders(id) on delete restrict,
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  meeting_type text not null check (meeting_type in ('online', 'in-person')),
  status text not null default 'confirmed'
    check (status in ('confirmed', 'cancelled', 'outcome_pending', 'completed', 'customer_no_show', 'merchant_no_show', 'attendance_disputed')),
  created_at timestamptz not null default now()
);
create index if not exists appointments_provider_id on app.appointments(provider_id);
create index if not exists appointments_service_id on app.appointments(service_id);

create table if not exists ops.audit_events (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid references public.providers(id) on delete restrict,
  aggregate_type text not null,
  aggregate_id uuid not null,
  action text not null,
  actor_type text not null,
  correlation_id text,
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_provider_id on ops.audit_events(provider_id);

create table if not exists ops.outbox_jobs (
  id uuid primary key default gen_random_uuid(),
  effect_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  aggregate_version bigint not null default 1,
  recipient_or_purpose text not null,
  status text not null default 'queued' check (status in ('queued', 'leased', 'succeeded', 'dead_letter')),
  due_at timestamptz not null default now(),
  lease_owner text,
  lease_generation bigint not null default 0 check (lease_generation >= 0),
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_safe_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (effect_type, aggregate_id, aggregate_version, recipient_or_purpose),
  check (
    (status = 'leased' and lease_owner is not null and lease_expires_at is not null)
    or status <> 'leased'
  )
);

alter table app.booking_attempts enable row level security;
alter table app.slot_allocations enable row level security;
alter table app.appointments enable row level security;
alter table finance.payment_orders enable row level security;
alter table finance.payment_attempts enable row level security;
alter table finance.gateway_events enable row level security;
alter table finance.payment_resolution_cases enable row level security;
alter table finance.refunds_v1 enable row level security;
alter table ops.audit_events enable row level security;
alter table ops.outbox_jobs enable row level security;

revoke all on all tables in schema app, finance, ops from public, anon, authenticated;
grant select, insert, update on all tables in schema app, finance, ops to service_role;

create or replace function public.acquire_booking_hold_v1(
  p_provider_id uuid,
  p_service_id uuid,
  p_booking_date date,
  p_start_time time,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_customer_contact_hash text,
  p_attempt_token_hash text,
  p_idempotency_key text,
  p_request_hash text,
  p_environment text,
  p_verification_grant_id uuid,
  p_policy_accepted_at timestamptz,
  p_meeting_type text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, app, finance, ops
as $$
declare
  v_service public.services%rowtype;
  v_provider public.providers%rowtype;
  v_existing app.booking_attempts%rowtype;
  v_attempt app.booking_attempts%rowtype;
  v_allocation app.slot_allocations%rowtype;
  v_order finance.payment_orders%rowtype;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_occupancy_ends_at timestamptz;
  v_hold_expires_at timestamptz := clock_timestamp() + interval '15 minutes';
  v_price_paise bigint;
begin
  if p_environment not in ('sandbox', 'production') then raise exception 'INVALID_ENVIRONMENT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_provider_id::text, 1));

  select * into v_existing
  from app.booking_attempts
  where provider_id = p_provider_id and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    select * into v_order from finance.payment_orders where booking_attempt_id = v_existing.id;
    return jsonb_build_object(
      'attemptId', v_existing.id,
      'paymentOrderId', v_order.id,
      'paymentStatus', v_order.payment_status,
      'fulfilmentStatus', v_order.fulfilment_status,
      'paymentSessionId', v_order.payment_session_id,
      'amountPaise', v_order.amount_paise,
      'currency', v_order.currency,
      'holdExpiresAt', v_existing.hold_expires_at
    );
  end if;

  update app.slot_allocations
  set status = 'expired', expired_at = clock_timestamp()
  where provider_id = p_provider_id and status = 'held' and hold_expires_at <= clock_timestamp();

  update app.booking_attempts
  set status = 'expired', expired_at = clock_timestamp()
  where provider_id = p_provider_id and status = 'hold_active' and hold_expires_at <= clock_timestamp();

  update finance.payment_orders po
  set payment_status = 'closed_unpaid', updated_at = clock_timestamp()
  from app.booking_attempts ba
  where po.booking_attempt_id = ba.id
    and ba.provider_id = p_provider_id
    and ba.status = 'expired'
    and po.payment_status = 'pending';

  if exists (
    select 1 from app.booking_attempts
    where provider_id = p_provider_id
      and customer_contact_hash = p_customer_contact_hash
      and status in ('hold_active', 'manual_review')
  ) then
    raise exception 'ACTIVE_HOLD_EXISTS';
  end if;

  select * into v_service from public.services
  where id = p_service_id and provider_id = p_provider_id and active = true
  for share;
  if not found then raise exception 'SERVICE_NOT_FOUND'; end if;

  select * into v_provider from public.providers where id = p_provider_id for share;
  if not found then raise exception 'PROVIDER_NOT_FOUND'; end if;

  begin
    v_starts_at := (p_booking_date + p_start_time) at time zone coalesce(v_provider.timezone, 'Asia/Kolkata');
  exception when invalid_parameter_value then
    raise exception 'INVALID_TIMEZONE';
  end;
  if v_starts_at <= clock_timestamp() then raise exception 'INVALID_SLOT'; end if;

  v_ends_at := v_starts_at + make_interval(mins => greatest(coalesce(v_service.duration, 60), 1));
  v_occupancy_ends_at := v_ends_at + make_interval(mins => greatest(coalesce(v_provider.buffer_time, 0), 0));
  v_price_paise := round(coalesce(v_service.price, 0) * 100)::bigint;
  if v_price_paise <= 0 then raise exception 'PAYMENT_NOT_REQUIRED'; end if;

  insert into app.booking_attempts (
    provider_id, service_id, customer_name, customer_phone, customer_email,
    customer_contact_hash, verification_grant_id, attempt_token_hash,
    booking_date, start_time, starts_at, ends_at, hold_expires_at,
    price_paise, meeting_type, policy_accepted_at, idempotency_key, request_hash
  ) values (
    p_provider_id, p_service_id, p_customer_name, p_customer_phone, nullif(p_customer_email, ''),
    p_customer_contact_hash, p_verification_grant_id, p_attempt_token_hash,
    p_booking_date, p_start_time, v_starts_at, v_ends_at, v_hold_expires_at,
    v_price_paise, p_meeting_type, p_policy_accepted_at, p_idempotency_key, p_request_hash
  ) returning * into v_attempt;

  begin
    insert into app.slot_allocations (
      provider_id, attempt_id, starts_at, occupancy_ends_at, hold_expires_at
    ) values (
      p_provider_id, v_attempt.id, v_starts_at, v_occupancy_ends_at, v_hold_expires_at
    ) returning * into v_allocation;
  exception when exclusion_violation then
    raise exception 'SLOT_UNAVAILABLE';
  end;

  insert into finance.payment_orders (
    provider_id, booking_attempt_id, environment, gateway_account, amount_paise
  ) values (
    p_provider_id,
    v_attempt.id,
    p_environment,
    'calup_primary',
    v_price_paise
  ) returning * into v_order;

  insert into ops.audit_events(provider_id, aggregate_type, aggregate_id, action, actor_type, safe_metadata)
  values (p_provider_id, 'booking_attempt', v_attempt.id, 'booking.hold_acquired', 'customer', jsonb_build_object('expiresAt', v_hold_expires_at));

  return jsonb_build_object(
    'attemptId', v_attempt.id,
    'allocationId', v_allocation.id,
    'paymentOrderId', v_order.id,
    'paymentStatus', v_order.payment_status,
    'fulfilmentStatus', v_order.fulfilment_status,
    'amountPaise', v_order.amount_paise,
    'currency', v_order.currency,
    'holdExpiresAt', v_attempt.hold_expires_at
  );
exception
  when unique_violation then
    raise exception 'ACTIVE_HOLD_EXISTS';
end;
$$;

create or replace function public.mark_cashfree_order_created_v1(
  p_payment_order_id uuid,
  p_provider_order_id text,
  p_payment_session_id text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, app, finance, ops
as $$
declare v_order finance.payment_orders%rowtype; v_attempt app.booking_attempts%rowtype;
begin
  select * into v_order from finance.payment_orders where id = p_payment_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.payment_status not in ('created', 'creation_unknown', 'pending') then raise exception 'STATE_CONFLICT'; end if;
  if v_order.provider_order_id is not null and v_order.provider_order_id <> p_provider_order_id then raise exception 'STATE_CONFLICT'; end if;
  update finance.payment_orders set payment_status = 'pending', provider_order_id = p_provider_order_id,
    payment_session_id = p_payment_session_id, last_safe_error_code = null, updated_at = clock_timestamp()
  where id = p_payment_order_id returning * into v_order;
  select * into v_attempt from app.booking_attempts where id = v_order.booking_attempt_id;
  insert into ops.audit_events(provider_id, aggregate_type, aggregate_id, action, actor_type)
  values (v_order.provider_id, 'payment_order', v_order.id, 'payment.order_created', 'system');
  return jsonb_build_object('attemptId', v_attempt.id, 'paymentOrderId', v_order.id,
    'paymentStatus', v_order.payment_status, 'fulfilmentStatus', v_order.fulfilment_status,
    'paymentSessionId', v_order.payment_session_id, 'amountPaise', v_order.amount_paise,
    'currency', v_order.currency, 'holdExpiresAt', v_attempt.hold_expires_at);
end;
$$;

create or replace function public.mark_cashfree_order_unknown_v1(p_payment_order_id uuid, p_provider_order_id text, p_safe_error_code text)
returns void language plpgsql security definer set search_path = pg_catalog, finance
as $$
begin
  update finance.payment_orders set payment_status = 'creation_unknown', provider_order_id = p_provider_order_id,
    last_safe_error_code = left(p_safe_error_code, 100), next_reconcile_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = p_payment_order_id and payment_status = 'created';
end;
$$;

create or replace function public.mark_cashfree_order_creation_failed_v1(p_payment_order_id uuid, p_safe_error_code text)
returns void language plpgsql security definer set search_path = pg_catalog, app, finance, ops
as $$
declare v_order finance.payment_orders%rowtype;
begin
  select * into v_order from finance.payment_orders where id = p_payment_order_id for update;
  if not found or v_order.payment_status not in ('created', 'creation_unknown') then return; end if;
  update finance.payment_orders set payment_status = 'creation_failed', last_safe_error_code = left(p_safe_error_code, 100), updated_at = clock_timestamp() where id = v_order.id;
  update app.slot_allocations set status = 'released', release_reason = 'payment_creation_failed', released_at = clock_timestamp()
    where attempt_id = v_order.booking_attempt_id and status = 'held';
  update app.booking_attempts set status = 'released', released_at = clock_timestamp()
    where id = v_order.booking_attempt_id and status = 'hold_active';
  insert into ops.audit_events(provider_id, aggregate_type, aggregate_id, action, actor_type, safe_metadata)
  values (v_order.provider_id, 'payment_order', v_order.id, 'payment.creation_failed', 'system', jsonb_build_object('code', left(p_safe_error_code, 100)));
end;
$$;

create or replace function public.get_booking_attempt_v1(p_attempt_id uuid, p_attempt_token_hash text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, app, finance
as $$
declare v_attempt app.booking_attempts%rowtype; v_order finance.payment_orders%rowtype; v_appointment_id uuid; v_case_id uuid;
begin
  select * into v_attempt from app.booking_attempts where id = p_attempt_id and attempt_token_hash = p_attempt_token_hash;
  if not found then return null; end if;
  select * into v_order from finance.payment_orders where booking_attempt_id = v_attempt.id;
  select id into v_appointment_id from app.appointments where booking_attempt_id = v_attempt.id;
  select id into v_case_id from finance.payment_resolution_cases where booking_attempt_id = v_attempt.id;
  return jsonb_build_object('attemptId', v_attempt.id, 'attemptStatus', v_attempt.status,
    'paymentOrderId', v_order.id, 'paymentStatus', v_order.payment_status,
    'fulfilmentStatus', v_order.fulfilment_status, 'paymentSessionId', v_order.payment_session_id,
    'amountPaise', v_order.amount_paise, 'currency', v_order.currency,
    'holdExpiresAt', v_attempt.hold_expires_at,
    'remainingSeconds', greatest(0, floor(extract(epoch from (v_attempt.hold_expires_at - clock_timestamp())))::integer),
    'appointmentId', v_appointment_id, 'resolutionCaseId', v_case_id);
end;
$$;

create or replace function public.get_cashfree_reconciliation_context_v1(p_attempt_id uuid)
returns jsonb language sql security definer set search_path = pg_catalog, app, finance
as $$
  select jsonb_build_object('attemptId', ba.id, 'paymentOrderId', po.id,
    'providerOrderId', po.provider_order_id, 'amountPaise', po.amount_paise,
    'currency', po.currency, 'paymentStatus', po.payment_status,
    'fulfilmentStatus', po.fulfilment_status, 'paymentSessionId', po.payment_session_id,
    'attemptStatus', ba.status, 'holdExpiresAt', ba.hold_expires_at,
    'remainingSeconds', greatest(0, floor(extract(epoch from (ba.hold_expires_at - clock_timestamp())))::integer),
    'appointmentId', (select id from app.appointments where booking_attempt_id = ba.id),
    'resolutionCaseId', (select id from finance.payment_resolution_cases where booking_attempt_id = ba.id))
  from app.booking_attempts ba join finance.payment_orders po on po.booking_attempt_id = ba.id
  where ba.id = p_attempt_id;
$$;

create or replace function public.finalize_verified_payment_v1(
  p_payment_order_id uuid,
  p_provider_order_id text,
  p_provider_payment_id text,
  p_paid_amount_paise bigint,
  p_currency text,
  p_paid_at timestamptz,
  p_source text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, app, finance, ops
as $$
declare
  v_order finance.payment_orders%rowtype;
  v_attempt app.booking_attempts%rowtype;
  v_allocation app.slot_allocations%rowtype;
  v_appointment_id uuid;
  v_case_id uuid;
begin
  select * into v_order from finance.payment_orders where id = p_payment_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.provider_order_id <> p_provider_order_id or v_order.amount_paise <> p_paid_amount_paise or v_order.currency <> p_currency then
    raise exception 'PAYMENT_MISMATCH';
  end if;
  if v_order.payment_status = 'succeeded' then
    select id into v_appointment_id from app.appointments where payment_order_id = v_order.id;
    select id into v_case_id from finance.payment_resolution_cases where payment_order_id = v_order.id;
    return jsonb_build_object('attemptId', v_order.booking_attempt_id, 'paymentStatus', 'succeeded',
      'fulfilmentStatus', v_order.fulfilment_status, 'appointmentId', v_appointment_id, 'resolutionCaseId', v_case_id);
  end if;
  if v_order.payment_status not in ('creation_unknown', 'pending', 'closed_unpaid') then raise exception 'STATE_CONFLICT'; end if;

  insert into finance.payment_attempts(payment_order_id, provider_payment_id, status, amount_paise, currency, paid_at, source)
  values (v_order.id, p_provider_payment_id, 'succeeded', p_paid_amount_paise, p_currency, p_paid_at, p_source)
  on conflict (payment_order_id, provider_payment_id) do nothing;

  update finance.payment_orders set payment_status = 'succeeded', paid_at = p_paid_at,
    late_success_at = case when payment_status = 'closed_unpaid' then clock_timestamp() else late_success_at end,
    updated_at = clock_timestamp() where id = v_order.id returning * into v_order;

  select * into v_attempt from app.booking_attempts where id = v_order.booking_attempt_id for update;
  select * into v_allocation from app.slot_allocations where attempt_id = v_attempt.id for update;

  if v_allocation.status = 'held' and v_attempt.status = 'hold_active' and clock_timestamp() < v_allocation.hold_expires_at then
    update app.slot_allocations set status = 'reserved', reserved_at = clock_timestamp() where id = v_allocation.id;
    update app.booking_attempts set status = 'confirmed', confirmed_at = clock_timestamp() where id = v_attempt.id;
    update finance.payment_orders set fulfilment_status = 'fulfilled', updated_at = clock_timestamp() where id = v_order.id;
    insert into app.appointments(provider_id, service_id, booking_attempt_id, allocation_id, payment_order_id,
      customer_name, customer_phone, customer_email, starts_at, ends_at, meeting_type)
    values (v_attempt.provider_id, v_attempt.service_id, v_attempt.id, v_allocation.id, v_order.id,
      v_attempt.customer_name, v_attempt.customer_phone, v_attempt.customer_email, v_attempt.starts_at, v_attempt.ends_at, v_attempt.meeting_type)
    on conflict (payment_order_id) do nothing returning id into v_appointment_id;
    if v_appointment_id is null then select id into v_appointment_id from app.appointments where payment_order_id = v_order.id; end if;
    insert into ops.outbox_jobs(effect_type, aggregate_type, aggregate_id, recipient_or_purpose)
    values ('appointment_confirmed', 'appointment', v_appointment_id, 'confirmation_and_calendar') on conflict do nothing;
    insert into ops.audit_events(provider_id, aggregate_type, aggregate_id, action, actor_type)
    values (v_order.provider_id, 'payment_order', v_order.id, 'payment.fulfilled', 'cashfree');
    return jsonb_build_object('attemptId', v_attempt.id, 'attemptStatus', 'confirmed', 'paymentStatus', 'succeeded',
      'fulfilmentStatus', 'fulfilled', 'appointmentId', v_appointment_id, 'resolutionCaseId', null);
  end if;

  if v_allocation.status = 'held' then
    update app.slot_allocations set status = 'expired', expired_at = clock_timestamp() where id = v_allocation.id;
  end if;
  if v_attempt.status = 'hold_active' then
    update app.booking_attempts set status = 'expired', expired_at = clock_timestamp() where id = v_attempt.id;
  end if;
  update finance.payment_orders set fulfilment_status = 'unfulfilled', late_success_at = coalesce(late_success_at, clock_timestamp()), updated_at = clock_timestamp() where id = v_order.id;
  insert into finance.payment_resolution_cases(payment_order_id, booking_attempt_id, lost_allocation_id, provider_id, reason, review_due_at)
  values (v_order.id, v_attempt.id, v_allocation.id, v_order.provider_id, 'slot_ownership_unavailable',
    clock_timestamp() + case extract(isodow from clock_timestamp())
      when 5 then interval '3 days'
      when 6 then interval '2 days'
      else interval '1 day'
    end)
  on conflict (payment_order_id) do nothing returning id into v_case_id;
  if v_case_id is null then select id into v_case_id from finance.payment_resolution_cases where payment_order_id = v_order.id; end if;
  insert into ops.outbox_jobs(effect_type, aggregate_type, aggregate_id, recipient_or_purpose)
  values ('payment_unfulfilled', 'payment_resolution_case', v_case_id, 'manual_review_and_refund') on conflict do nothing;
  insert into ops.audit_events(provider_id, aggregate_type, aggregate_id, action, actor_type, safe_metadata)
  values (v_order.provider_id, 'payment_order', v_order.id, 'payment.unfulfilled', 'cashfree', jsonb_build_object('resolutionCaseId', v_case_id));
  return jsonb_build_object('attemptId', v_attempt.id, 'attemptStatus', v_attempt.status, 'paymentStatus', 'succeeded',
    'fulfilmentStatus', 'unfulfilled', 'appointmentId', null, 'resolutionCaseId', v_case_id);
end;
$$;

create or replace function public.record_cashfree_event_v1(
  p_event_key text, p_event_type text, p_provider_order_id text, p_provider_payment_id text,
  p_payload_hash text, p_webhook_timestamp text, p_environment text, p_gateway_account text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, finance
as $$
declare v_event finance.gateway_events%rowtype;
begin
  if p_environment not in ('sandbox', 'production') then raise exception 'INVALID_ENVIRONMENT'; end if;
  insert into finance.gateway_events(environment, gateway_account, event_key, event_type, provider_order_id,
    provider_payment_id, payload_hash, webhook_timestamp)
  values (p_environment, p_gateway_account, p_event_key, p_event_type, p_provider_order_id, p_provider_payment_id, p_payload_hash, p_webhook_timestamp)
  on conflict (provider, environment, gateway_account, event_key) do nothing
  returning * into v_event;
  if found then return jsonb_build_object('eventId', v_event.id, 'alreadyProcessed', false); end if;
  select * into v_event from finance.gateway_events
  where provider = 'cashfree'
    and environment = p_environment
    and gateway_account = p_gateway_account and event_key = p_event_key;
  if v_event.payload_hash <> p_payload_hash then raise exception 'WEBHOOK_REPLAY_MISMATCH'; end if;
  return jsonb_build_object('eventId', v_event.id, 'alreadyProcessed', v_event.status = 'processed');
end;
$$;

create or replace function public.finish_cashfree_event_v1(p_event_key text, p_status text, p_safe_error text)
returns void language plpgsql security definer set search_path = pg_catalog, finance
as $$
begin
  if p_status not in ('processed', 'rejected', 'review_required') then raise exception 'INVALID_STATE_INPUT'; end if;
  update finance.gateway_events set status = p_status, safe_error = left(p_safe_error, 120), processed_at = clock_timestamp()
  where provider = 'cashfree' and event_key = p_event_key and status in ('received', 'review_required');
end;
$$;

create or replace function public.find_attempt_by_provider_order_v1(p_provider_order_id text)
returns uuid language sql security definer set search_path = pg_catalog, finance
as $$ select booking_attempt_id from finance.payment_orders where provider_order_id = p_provider_order_id; $$;

create or replace function public.get_cashfree_busy_slots_v1(
  p_provider_id uuid,
  p_booking_date date
) returns table(start_time time, end_time time, actual_end_time time)
language sql security definer
set search_path = pg_catalog, public, app
as $$
  select
    ba.start_time,
    (ba.ends_at at time zone coalesce(nullif(p.timezone, ''), 'Asia/Kolkata'))::time as end_time,
    null::time as actual_end_time
  from app.slot_allocations sa
  join app.booking_attempts ba on ba.id = sa.attempt_id
  join public.providers p on p.id = sa.provider_id
  where sa.provider_id = p_provider_id
    and ba.booking_date = p_booking_date
    and (
      sa.status in ('reserved', 'manual_review')
      or (sa.status = 'held' and sa.hold_expires_at > clock_timestamp())
    )
  order by ba.start_time;
$$;

create or replace function public.expire_booking_holds_v1(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = pg_catalog, app, finance, ops
as $$
declare v_count integer;
begin
  with due as (
    select id from app.booking_attempts where status = 'hold_active' and hold_expires_at <= clock_timestamp()
    order by hold_expires_at for update skip locked limit greatest(1, least(p_limit, 1000))
  ), expired_attempts as (
    update app.booking_attempts ba set status = 'expired', expired_at = clock_timestamp()
    from due where ba.id = due.id returning ba.id
  )
  update app.slot_allocations sa set status = 'expired', expired_at = clock_timestamp()
  from expired_attempts ea where sa.attempt_id = ea.id and sa.status = 'held';
  get diagnostics v_count = row_count;
  update finance.payment_orders po set payment_status = 'closed_unpaid', updated_at = clock_timestamp()
  where po.booking_attempt_id in (select id from app.booking_attempts where status = 'expired') and po.payment_status = 'pending';
  return v_count;
end;
$$;

create or replace function public.claim_cashfree_reconciliation_v1(p_limit integer default 25)
returns setof uuid language sql security definer set search_path = pg_catalog, finance
as $$
  with due as (
    select id
    from finance.payment_orders
    where payment_path = 'cashfree'
      and provider_order_id is not null
      and payment_status in ('creation_unknown', 'pending', 'closed_unpaid')
      and next_reconcile_at <= clock_timestamp()
    order by next_reconcile_at
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  ), claimed as (
    update finance.payment_orders po
    set reconcile_attempt_count = po.reconcile_attempt_count + 1,
        next_reconcile_at = clock_timestamp() + make_interval(secs => least(600, 30 * (po.reconcile_attempt_count + 1))),
        updated_at = clock_timestamp()
    from due
    where po.id = due.id
    returning po.booking_attempt_id
  )
  select booking_attempt_id from claimed;
$$;

create or replace function public.claim_outbox_jobs_v1(
  p_lease_owner text,
  p_limit integer default 25,
  p_lease_seconds integer default 60
) returns table(job_id uuid, lease_generation bigint, effect_type text, aggregate_type text, aggregate_id uuid, recipient_or_purpose text)
language sql security definer set search_path = pg_catalog, ops
as $$
  with due as (
    select id, status as old_status
    from ops.outbox_jobs
    where (status = 'queued' and due_at <= clock_timestamp())
       or (status = 'leased' and lease_expires_at <= clock_timestamp())
    order by due_at
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  ), claimed as (
    update ops.outbox_jobs job
    set status = 'leased', lease_owner = p_lease_owner,
        lease_generation = job.lease_generation + 1,
        lease_expires_at = clock_timestamp() + make_interval(secs => greatest(15, least(p_lease_seconds, 600))),
        attempt_count = job.attempt_count + 1, updated_at = clock_timestamp()
    from due where job.id = due.id
    returning job.id as claimed_job_id, job.lease_generation as claimed_generation,
      job.effect_type as claimed_effect_type, job.aggregate_type as claimed_aggregate_type,
      job.aggregate_id as claimed_aggregate_id, job.recipient_or_purpose as claimed_recipient,
      due.old_status
  ), audited as (
    insert into ops.audit_events(aggregate_type, aggregate_id, action, actor_type, safe_metadata)
    select 'outbox_job', claimed_job_id,
      case when old_status = 'leased' then 'outbox.lease_reclaimed' else 'outbox.job_claimed' end,
      'worker', jsonb_build_object('leaseOwner', p_lease_owner, 'leaseGeneration', claimed_generation)
    from claimed
  )
  select claimed_job_id, claimed_generation, claimed_effect_type, claimed_aggregate_type, claimed_aggregate_id, claimed_recipient from claimed;
$$;

create or replace function public.heartbeat_outbox_job_v1(
  p_job_id uuid, p_lease_owner text, p_lease_generation bigint, p_lease_seconds integer default 60
) returns boolean
language plpgsql security definer set search_path = pg_catalog, ops
as $$
begin
  update ops.outbox_jobs
  set lease_expires_at = clock_timestamp() + make_interval(secs => greatest(15, least(p_lease_seconds, 600))),
      updated_at = clock_timestamp()
  where id = p_job_id and status = 'leased' and lease_owner = p_lease_owner
    and lease_generation = p_lease_generation and lease_expires_at > clock_timestamp();
  if found then
    insert into ops.audit_events(aggregate_type, aggregate_id, action, actor_type, safe_metadata)
    values ('outbox_job', p_job_id, 'outbox.lease_heartbeat', 'worker', jsonb_build_object('leaseGeneration', p_lease_generation));
  end if;
  return found;
end;
$$;

create or replace function public.complete_outbox_job_v1(
  p_job_id uuid, p_lease_owner text, p_lease_generation bigint,
  p_succeeded boolean, p_safe_error text default null, p_max_attempts integer default 8
) returns boolean
language plpgsql security definer set search_path = pg_catalog, ops
as $$
declare v_job ops.outbox_jobs%rowtype;
begin
  select * into v_job from ops.outbox_jobs
  where id = p_job_id and status = 'leased' and lease_owner = p_lease_owner
    and lease_generation = p_lease_generation for update;
  if not found then return false; end if;

  if p_succeeded then
    update ops.outbox_jobs set status = 'succeeded', lease_owner = null, lease_expires_at = null,
      last_safe_error = null, updated_at = clock_timestamp() where id = v_job.id;
  elsif v_job.attempt_count >= greatest(1, p_max_attempts) then
    update ops.outbox_jobs set status = 'dead_letter', lease_owner = null, lease_expires_at = null,
      last_safe_error = left(p_safe_error, 200), updated_at = clock_timestamp() where id = v_job.id;
  else
    update ops.outbox_jobs set status = 'queued', lease_owner = null, lease_expires_at = null,
      due_at = clock_timestamp() + make_interval(secs => least(3600, 30 * v_job.attempt_count)),
      last_safe_error = left(p_safe_error, 200), updated_at = clock_timestamp() where id = v_job.id;
  end if;
  insert into ops.audit_events(aggregate_type, aggregate_id, action, actor_type, safe_metadata)
  values ('outbox_job', v_job.id,
    case when p_succeeded then 'outbox.job_completed'
         when v_job.attempt_count >= greatest(1, p_max_attempts) then 'outbox.job_dead_lettered'
         else 'outbox.job_requeued' end,
    'worker', jsonb_build_object('leaseGeneration', p_lease_generation));
  return true;
end;
$$;

revoke all on function public.acquire_booking_hold_v1(uuid, uuid, date, time, text, text, text, text, text, text, text, text, uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.acquire_booking_hold_v1(uuid, uuid, date, time, text, text, text, text, text, text, text, text, uuid, timestamptz, text) to service_role;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'mark_cashfree_order_created_v1', 'mark_cashfree_order_unknown_v1',
      'mark_cashfree_order_creation_failed_v1', 'get_booking_attempt_v1',
      'get_cashfree_reconciliation_context_v1', 'finalize_verified_payment_v1',
      'record_cashfree_event_v1', 'finish_cashfree_event_v1',
      'find_attempt_by_provider_order_v1', 'get_cashfree_busy_slots_v1',
      'expire_booking_holds_v1',
      'claim_cashfree_reconciliation_v1', 'claim_outbox_jobs_v1',
      'heartbeat_outbox_job_v1', 'complete_outbox_job_v1'
    )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.signature);
    execute format('grant execute on function %s to service_role', r.signature);
  end loop;
end $$;

comment on schema finance is 'Server-only Calup financial truth. Browser roles have no access.';
comment on function public.finalize_verified_payment_v1 is 'Verifies current ownership at processing time; late success cannot revive or steal a slot.';
comment on function public.get_cashfree_busy_slots_v1 is 'Returns PII-free active Cashfree allocation intervals to the server for public availability.';
