begin;

create table if not exists app.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null default '',
  duration_days integer not null default 30 check (duration_days = 30),
  base_amount_paise bigint not null check (base_amount_paise > 0),
  tax_rate_bps integer not null check (tax_rate_bps between 0 and 10000),
  tax_amount_paise bigint not null check (tax_amount_paise >= 0),
  total_amount_paise bigint not null check (total_amount_paise = base_amount_paise + tax_amount_paise),
  currency text not null default 'INR' check (currency = 'INR'),
  is_test boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into app.subscription_plans(
  code, name, description, base_amount_paise, tax_rate_bps, tax_amount_paise, total_amount_paise, is_test
)
values (
  'calup_30_day_sandbox', 'Calup 30-Day Sandbox',
  'Sandbox-only 30-day access. Replace pricing and tax configuration before production.',
  100, 1800, 18, 118, true
)
on conflict (code) do nothing;

create table if not exists app.merchant_entitlements (
  provider_id uuid primary key references public.providers(id) on delete restrict,
  plan_id uuid references app.subscription_plans(id) on delete restrict,
  status text not null check (status in ('active', 'grace', 'frozen', 'deletion_scheduled', 'operational_deleted')),
  source text not null check (source in ('migration', 'paid', 'access_code', 'service_credit')),
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  grace_ends_at timestamptz not null,
  frozen_at timestamptz,
  deletion_scheduled_at timestamptz,
  last_subscription_order_id uuid,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > starts_at),
  check (grace_ends_at = expires_at + interval '5 days')
);

create index if not exists merchant_entitlements_lifecycle_due
  on app.merchant_entitlements(status, expires_at, grace_ends_at, deletion_scheduled_at);

create table if not exists app.merchant_billing_profiles (
  provider_id uuid primary key references public.providers(id) on delete restrict,
  legal_name text not null check (char_length(btrim(legal_name)) between 2 and 160),
  address_line1 text not null check (char_length(btrim(address_line1)) between 5 and 240),
  address_line2 text,
  city text not null check (char_length(btrim(city)) between 2 and 100),
  state text not null check (char_length(btrim(state)) between 2 and 100),
  postal_code text not null check (postal_code ~ '^[1-9][0-9]{5}$'),
  gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  gstin_verified boolean not null default false,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists finance.subscription_orders (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete restrict,
  plan_id uuid not null references app.subscription_plans(id) on delete restrict,
  checkout_status text not null default 'created' check (checkout_status in ('created', 'pending', 'closed', 'expired')),
  application_status text not null default 'not_ready'
    check (application_status in ('not_ready', 'applied', 'review_required', 'refund_required', 'resolved')),
  base_amount_paise bigint not null check (base_amount_paise > 0),
  tax_rate_bps integer not null check (tax_rate_bps between 0 and 10000),
  tax_amount_paise bigint not null check (tax_amount_paise >= 0),
  total_amount_paise bigint not null check (total_amount_paise = base_amount_paise + tax_amount_paise),
  currency text not null default 'INR' check (currency = 'INR'),
  plan_snapshot jsonb not null,
  billing_snapshot jsonb not null,
  idempotency_key text not null,
  request_hash text not null check (char_length(request_hash) = 64),
  expires_at timestamptz not null,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_id, idempotency_key),
  check (expires_at > created_at)
);

create unique index if not exists subscription_orders_one_open_per_provider
  on finance.subscription_orders(provider_id)
  where checkout_status in ('created', 'pending');
create index if not exists subscription_orders_provider_history
  on finance.subscription_orders(provider_id, created_at desc);

alter table finance.payment_orders alter column booking_attempt_id drop not null;
alter table finance.payment_orders
  add column if not exists subscription_order_id uuid unique references finance.subscription_orders(id) on delete restrict;
alter table finance.payment_orders drop constraint if exists payment_orders_owner_check;
alter table finance.payment_orders add constraint payment_orders_owner_check check (
  (purpose = 'service_booking' and booking_attempt_id is not null and subscription_order_id is null)
  or (purpose = 'subscription' and booking_attempt_id is null and subscription_order_id is not null)
);

alter table app.merchant_entitlements
  drop constraint if exists merchant_entitlements_last_subscription_order_id_fkey;
alter table app.merchant_entitlements
  add constraint merchant_entitlements_last_subscription_order_id_fkey
  foreign key (last_subscription_order_id) references finance.subscription_orders(id) on delete restrict;

create sequence if not exists finance.subscription_invoice_number_seq;

create table if not exists finance.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete restrict,
  subscription_order_id uuid not null unique references finance.subscription_orders(id) on delete restrict,
  invoice_number text not null unique,
  base_amount_paise bigint not null,
  tax_amount_paise bigint not null,
  total_amount_paise bigint not null,
  currency text not null default 'INR' check (currency = 'INR'),
  billing_snapshot jsonb not null,
  plan_snapshot jsonb not null,
  is_test boolean not null default true,
  issued_at timestamptz not null default now(),
  check (total_amount_paise = base_amount_paise + tax_amount_paise)
);

create table if not exists finance.subscription_credit_notes (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete restrict,
  invoice_id uuid not null references finance.subscription_invoices(id) on delete restrict,
  credit_note_number text not null unique,
  amount_paise bigint not null check (amount_paise > 0),
  reason text not null,
  is_test boolean not null default true,
  issued_at timestamptz not null default now()
);

create table if not exists finance.subscription_payment_reviews (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete restrict,
  subscription_order_id uuid not null unique references finance.subscription_orders(id) on delete restrict,
  reason text not null check (reason in ('late_success', 'duplicate_success', 'amount_mismatch', 'merchant_mismatch')),
  status text not null default 'open' check (status in ('open', 'investigating', 'applied', 'refund_required', 'resolved')),
  review_due_at timestamptz not null default (now() + interval '1 day'),
  safe_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists app.access_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (char_length(code_hash) = 64),
  code_hint text not null,
  bound_provider_id uuid references public.providers(id) on delete restrict,
  duration_days integer not null default 30 check (duration_days between 1 and 365),
  max_redemptions integer not null default 1 check (max_redemptions > 0),
  redemption_count integer not null default 0 check (redemption_count between 0 and max_redemptions),
  status text not null default 'active' check (status in ('active', 'revoked', 'exhausted')),
  valid_from timestamptz not null default now(),
  valid_until timestamptz not null,
  reason text not null,
  created_by text not null default 'calup_admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_until > valid_from)
);

create table if not exists app.access_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  access_code_id uuid not null references app.access_codes(id) on delete restrict,
  provider_id uuid not null references public.providers(id) on delete restrict,
  entitlement_starts_at timestamptz not null,
  entitlement_expires_at timestamptz not null,
  redeemed_at timestamptz not null default now(),
  unique(access_code_id, provider_id)
);

create table if not exists app.service_credits (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete restrict,
  duration_days integer not null check (duration_days between 1 and 365),
  reason text not null,
  incident_reference text,
  status text not null default 'issued' check (status in ('issued', 'applied', 'revoked')),
  applied_at timestamptz,
  created_at timestamptz not null default now()
);

do $$
declare v_plan_id uuid;
begin
  select id into v_plan_id from app.subscription_plans where code = 'calup_30_day_sandbox';
  insert into app.merchant_entitlements(
    provider_id, plan_id, status, source, starts_at, expires_at, grace_ends_at
  )
  select p.id, v_plan_id, 'active', 'migration', statement_timestamp(),
    statement_timestamp() + interval '30 days', statement_timestamp() + interval '35 days'
  from public.providers p
  on conflict (provider_id) do nothing;

  insert into ops.audit_events(provider_id, aggregate_type, aggregate_id, action, actor_type, safe_metadata)
  select e.provider_id, 'merchant_entitlement', e.provider_id, 'entitlement.migration_granted', 'migration',
    jsonb_build_object('expiresAt', e.expires_at, 'source', e.source)
  from app.merchant_entitlements e
  where e.source = 'migration'
    and not exists (
      select 1 from ops.audit_events a
      where a.provider_id = e.provider_id and a.action = 'entitlement.migration_granted'
    );
end $$;

create or replace function public.transition_subscription_lifecycle_v1(p_provider_id uuid default null)
returns integer language plpgsql security definer
set search_path = pg_catalog, app, ops
as $$
declare v_count integer := 0; v_changed integer;
begin
  with changed as (
    update app.merchant_entitlements e
    set status = 'grace', version = version + 1, updated_at = clock_timestamp()
    where (p_provider_id is null or e.provider_id = p_provider_id)
      and e.status = 'active' and e.expires_at <= clock_timestamp() and e.grace_ends_at > clock_timestamp()
    returning e.*
  )
  insert into ops.audit_events(provider_id, aggregate_type, aggregate_id, action, actor_type)
  select provider_id, 'merchant_entitlement', provider_id, 'entitlement.grace_started', 'worker' from changed;
  get diagnostics v_changed = row_count; v_count := v_count + v_changed;

  with changed as (
    update app.merchant_entitlements e
    set status = 'frozen', frozen_at = coalesce(frozen_at, clock_timestamp()),
      deletion_scheduled_at = coalesce(deletion_scheduled_at, clock_timestamp() + interval '90 days'),
      version = version + 1, updated_at = clock_timestamp()
    where (p_provider_id is null or e.provider_id = p_provider_id)
      and e.status in ('active', 'grace') and e.grace_ends_at <= clock_timestamp()
    returning e.*
  )
  insert into ops.audit_events(provider_id, aggregate_type, aggregate_id, action, actor_type, safe_metadata)
  select provider_id, 'merchant_entitlement', provider_id, 'entitlement.frozen', 'worker',
    jsonb_build_object('deletionScheduledAt', deletion_scheduled_at) from changed;
  get diagnostics v_changed = row_count; v_count := v_count + v_changed;

  with changed as (
    update app.merchant_entitlements e
    set status = 'deletion_scheduled', version = version + 1, updated_at = clock_timestamp()
    where (p_provider_id is null or e.provider_id = p_provider_id)
      and e.status = 'frozen' and e.deletion_scheduled_at <= clock_timestamp()
    returning e.*
  )
  insert into ops.audit_events(provider_id, aggregate_type, aggregate_id, action, actor_type)
  select provider_id, 'merchant_entitlement', provider_id, 'entitlement.deletion_due', 'worker' from changed;
  get diagnostics v_changed = row_count; v_count := v_count + v_changed;
  return v_count;
end;
$$;

create or replace function public.get_merchant_subscription_v1(p_provider_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app, finance
as $$
declare v_ent app.merchant_entitlements%rowtype; v_plan app.subscription_plans%rowtype;
declare v_billing app.merchant_billing_profiles%rowtype; v_order finance.subscription_orders%rowtype;
declare v_payment finance.payment_orders%rowtype;
begin
  perform public.transition_subscription_lifecycle_v1(p_provider_id);
  select * into v_ent from app.merchant_entitlements where provider_id = p_provider_id;
  select * into v_plan from app.subscription_plans
    where (v_ent.plan_id is null or id = v_ent.plan_id) and is_active
    order by (id = v_ent.plan_id) desc nulls last, created_at limit 1;
  select * into v_billing from app.merchant_billing_profiles where provider_id = p_provider_id;
  select * into v_order from finance.subscription_orders
    where provider_id = p_provider_id and checkout_status in ('created', 'pending')
    order by created_at desc limit 1;
  if v_order.id is not null then
    select * into v_payment from finance.payment_orders where subscription_order_id = v_order.id;
  end if;
  return jsonb_build_object(
    'entitlement', case when v_ent.provider_id is null then null else jsonb_build_object(
      'status', v_ent.status, 'source', v_ent.source, 'startsAt', v_ent.starts_at,
      'expiresAt', v_ent.expires_at, 'graceEndsAt', v_ent.grace_ends_at,
      'frozenAt', v_ent.frozen_at, 'deletionScheduledAt', v_ent.deletion_scheduled_at,
      'version', v_ent.version) end,
    'plan', case when v_plan.id is null then null else jsonb_build_object(
      'id', v_plan.id, 'code', v_plan.code, 'name', v_plan.name, 'description', v_plan.description,
      'durationDays', v_plan.duration_days, 'baseAmountPaise', v_plan.base_amount_paise,
      'taxRateBps', v_plan.tax_rate_bps, 'taxAmountPaise', v_plan.tax_amount_paise,
      'totalAmountPaise', v_plan.total_amount_paise, 'currency', v_plan.currency, 'isTest', v_plan.is_test) end,
    'billingProfile', case when v_billing.provider_id is null then null else jsonb_build_object(
      'legalName', v_billing.legal_name, 'addressLine1', v_billing.address_line1,
      'addressLine2', v_billing.address_line2, 'city', v_billing.city, 'state', v_billing.state,
      'postalCode', v_billing.postal_code, 'gstin', v_billing.gstin,
      'gstinVerified', v_billing.gstin_verified, 'version', v_billing.version) end,
    'openOrder', case when v_order.id is null then null else jsonb_build_object(
      'id', v_order.id, 'checkoutStatus', v_order.checkout_status,
      'applicationStatus', v_order.application_status, 'expiresAt', v_order.expires_at,
      'paymentStatus', v_payment.payment_status, 'paymentSessionId', v_payment.payment_session_id,
      'amountPaise', v_order.total_amount_paise, 'currency', v_order.currency) end,
    'documents', coalesce((select jsonb_agg(doc order by doc->>'issuedAt' desc) from (
      select jsonb_build_object('id', i.id, 'type', 'invoice', 'number', i.invoice_number,
        'amountPaise', i.total_amount_paise, 'currency', i.currency, 'issuedAt', i.issued_at, 'isTest', i.is_test) doc
      from finance.subscription_invoices i where i.provider_id = p_provider_id
      union all
      select jsonb_build_object('id', c.id, 'type', 'credit_note', 'number', c.credit_note_number,
        'amountPaise', c.amount_paise, 'currency', 'INR', 'issuedAt', c.issued_at, 'isTest', c.is_test)
      from finance.subscription_credit_notes c where c.provider_id = p_provider_id
    ) d), '[]'::jsonb),
    'review', (select jsonb_build_object('id', r.id, 'reason', r.reason, 'status', r.status,
      'reviewDueAt', r.review_due_at) from finance.subscription_payment_reviews r
      where r.provider_id = p_provider_id and r.status in ('open', 'investigating') order by r.created_at desc limit 1),
    'allowedActions', jsonb_build_object(
      'renew', v_ent.provider_id is null or v_ent.status in ('frozen', 'deletion_scheduled')
        or v_plan.is_test or v_ent.expires_at <= clock_timestamp() + interval '7 days',
      'redeemCode', true,
      'createBookings', coalesce(v_ent.status in ('active', 'grace'), false),
      'manageExistingObligations', coalesce(v_ent.status <> 'operational_deleted', true)
    ),
    'serverTime', clock_timestamp()
  );
end;
$$;

create or replace function public.update_merchant_billing_profile_v1(
  p_provider_id uuid, p_expected_version bigint, p_legal_name text, p_address_line1 text,
  p_address_line2 text, p_city text, p_state text, p_postal_code text, p_gstin text
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, app, ops
as $$
declare v_profile app.merchant_billing_profiles%rowtype;
begin
  if p_expected_version is null then
    insert into app.merchant_billing_profiles(provider_id, legal_name, address_line1, address_line2, city, state, postal_code, gstin)
    values (p_provider_id, btrim(p_legal_name), btrim(p_address_line1), nullif(btrim(p_address_line2), ''),
      btrim(p_city), btrim(p_state), btrim(p_postal_code), nullif(upper(btrim(p_gstin)), ''))
    on conflict (provider_id) do nothing returning * into v_profile;
    if v_profile.provider_id is null then raise exception 'VERSION_CONFLICT'; end if;
  else
    update app.merchant_billing_profiles set legal_name = btrim(p_legal_name), address_line1 = btrim(p_address_line1),
      address_line2 = nullif(btrim(p_address_line2), ''), city = btrim(p_city), state = btrim(p_state),
      postal_code = btrim(p_postal_code), gstin = nullif(upper(btrim(p_gstin)), ''),
      gstin_verified = case when coalesce(gstin, '') = coalesce(nullif(upper(btrim(p_gstin)), ''), '') then gstin_verified else false end,
      version = version + 1, updated_at = clock_timestamp()
    where provider_id = p_provider_id and version = p_expected_version returning * into v_profile;
    if v_profile.provider_id is null then raise exception 'VERSION_CONFLICT'; end if;
  end if;
  insert into ops.audit_events(provider_id, aggregate_type, aggregate_id, action, actor_type)
  values (p_provider_id, 'merchant_billing_profile', p_provider_id, 'billing_profile.updated', 'merchant');
  return jsonb_build_object('legalName', v_profile.legal_name, 'addressLine1', v_profile.address_line1,
    'addressLine2', v_profile.address_line2, 'city', v_profile.city, 'state', v_profile.state,
    'postalCode', v_profile.postal_code, 'gstin', v_profile.gstin,
    'gstinVerified', v_profile.gstin_verified, 'version', v_profile.version);
end;
$$;

create or replace function public.create_subscription_order_v1(
  p_provider_id uuid, p_plan_id uuid, p_environment text, p_idempotency_key text, p_request_hash text
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, app, finance, ops
as $$
declare v_plan app.subscription_plans%rowtype; v_ent app.merchant_entitlements%rowtype;
declare v_billing app.merchant_billing_profiles%rowtype; v_order finance.subscription_orders%rowtype;
declare v_payment finance.payment_orders%rowtype;
begin
  if p_environment not in ('sandbox', 'production') or char_length(p_request_hash) <> 64 then raise exception 'INVALID_STATE_INPUT'; end if;
  perform public.transition_subscription_lifecycle_v1(p_provider_id);
  select * into v_plan from app.subscription_plans where id = p_plan_id and is_active for share;
  if v_plan.id is null then raise exception 'PLAN_UNAVAILABLE'; end if;
  if p_environment = 'production' and v_plan.is_test then raise exception 'PLAN_UNAVAILABLE'; end if;
  select * into v_billing from app.merchant_billing_profiles where provider_id = p_provider_id;
  if v_billing.provider_id is null then raise exception 'BILLING_PROFILE_REQUIRED'; end if;
  select * into v_ent from app.merchant_entitlements where provider_id = p_provider_id for update;
  if v_ent.provider_id is not null and v_ent.status = 'active' and not v_plan.is_test
    and v_ent.expires_at > clock_timestamp() + interval '7 days' then raise exception 'RENEWAL_TOO_EARLY'; end if;

  update finance.subscription_orders set checkout_status = 'expired', updated_at = clock_timestamp()
  where provider_id = p_provider_id and checkout_status in ('created', 'pending') and expires_at <= clock_timestamp();
  update finance.payment_orders po set payment_status = 'closed_unpaid', updated_at = clock_timestamp()
  where po.subscription_order_id in (select id from finance.subscription_orders where provider_id = p_provider_id and checkout_status = 'expired')
    and po.payment_status in ('created', 'pending', 'creation_failed');

  select * into v_order from finance.subscription_orders
  where provider_id = p_provider_id and checkout_status in ('created', 'pending') for update;
  if v_order.id is not null then
    select * into v_payment from finance.payment_orders where subscription_order_id = v_order.id;
    return jsonb_build_object('orderId', v_order.id, 'paymentOrderId', v_payment.id,
      'checkoutStatus', v_order.checkout_status, 'applicationStatus', v_order.application_status,
      'paymentStatus', v_payment.payment_status, 'paymentSessionId', v_payment.payment_session_id,
      'expiresAt', v_order.expires_at, 'amountPaise', v_order.total_amount_paise, 'currency', v_order.currency,
      'reused', true);
  end if;

  select * into v_order from finance.subscription_orders where provider_id = p_provider_id and idempotency_key = p_idempotency_key;
  if v_order.id is not null then
    if v_order.request_hash <> p_request_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    select * into v_payment from finance.payment_orders where subscription_order_id = v_order.id;
    return jsonb_build_object('orderId', v_order.id, 'paymentOrderId', v_payment.id,
      'checkoutStatus', v_order.checkout_status, 'applicationStatus', v_order.application_status,
      'paymentStatus', v_payment.payment_status, 'paymentSessionId', v_payment.payment_session_id,
      'expiresAt', v_order.expires_at, 'amountPaise', v_order.total_amount_paise, 'currency', v_order.currency,
      'reused', true);
  end if;

  insert into finance.subscription_orders(provider_id, plan_id, base_amount_paise, tax_rate_bps,
    tax_amount_paise, total_amount_paise, currency, plan_snapshot, billing_snapshot,
    idempotency_key, request_hash, expires_at)
  values (p_provider_id, v_plan.id, v_plan.base_amount_paise, v_plan.tax_rate_bps,
    v_plan.tax_amount_paise, v_plan.total_amount_paise, v_plan.currency,
    jsonb_build_object('code', v_plan.code, 'name', v_plan.name, 'durationDays', v_plan.duration_days,
      'baseAmountPaise', v_plan.base_amount_paise, 'taxRateBps', v_plan.tax_rate_bps,
      'taxAmountPaise', v_plan.tax_amount_paise, 'totalAmountPaise', v_plan.total_amount_paise,
      'currency', v_plan.currency, 'isTest', v_plan.is_test),
    jsonb_build_object('legalName', v_billing.legal_name, 'addressLine1', v_billing.address_line1,
      'addressLine2', v_billing.address_line2, 'city', v_billing.city, 'state', v_billing.state,
      'postalCode', v_billing.postal_code, 'gstin', v_billing.gstin, 'gstinVerified', v_billing.gstin_verified),
    p_idempotency_key, p_request_hash, clock_timestamp() + interval '30 minutes') returning * into v_order;

  insert into finance.payment_orders(provider_id, booking_attempt_id, subscription_order_id, purpose,
    payment_path, environment, gateway_account, amount_paise, currency, payment_status, fulfilment_status)
  values (p_provider_id, null, v_order.id, 'subscription', 'cashfree', p_environment,
    'calup_subscription', v_order.total_amount_paise, v_order.currency, 'created', 'not_applicable')
  returning * into v_payment;
  insert into ops.audit_events(provider_id, aggregate_type, aggregate_id, action, actor_type)
  values (p_provider_id, 'subscription_order', v_order.id, 'subscription.order_created', 'merchant');
  return jsonb_build_object('orderId', v_order.id, 'paymentOrderId', v_payment.id,
    'checkoutStatus', v_order.checkout_status, 'applicationStatus', v_order.application_status,
    'paymentStatus', v_payment.payment_status, 'paymentSessionId', null,
    'expiresAt', v_order.expires_at, 'amountPaise', v_order.total_amount_paise, 'currency', v_order.currency,
    'reused', false);
end;
$$;

create or replace function public.mark_subscription_cashfree_order_created_v1(
  p_subscription_order_id uuid, p_provider_order_id text, p_payment_session_id text
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, finance
as $$
declare v_order finance.subscription_orders%rowtype; v_payment finance.payment_orders%rowtype;
begin
  select * into v_order from finance.subscription_orders where id = p_subscription_order_id for update;
  if v_order.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v_payment from finance.payment_orders where subscription_order_id = v_order.id for update;
  update finance.payment_orders set provider_order_id = p_provider_order_id,
    payment_session_id = p_payment_session_id, payment_status = 'pending', next_reconcile_at = clock_timestamp(),
    last_safe_error_code = null, updated_at = clock_timestamp()
  where id = v_payment.id and payment_status in ('created', 'creation_unknown', 'creation_failed', 'pending') returning * into v_payment;
  update finance.subscription_orders set checkout_status = 'pending', updated_at = clock_timestamp()
  where id = v_order.id and checkout_status = 'created' returning * into v_order;
  return jsonb_build_object('orderId', v_order.id, 'paymentOrderId', v_payment.id,
    'checkoutStatus', v_order.checkout_status, 'applicationStatus', v_order.application_status,
    'paymentStatus', v_payment.payment_status, 'paymentSessionId', v_payment.payment_session_id,
    'providerOrderId', v_payment.provider_order_id, 'expiresAt', v_order.expires_at,
    'amountPaise', v_order.total_amount_paise, 'currency', v_order.currency);
end;
$$;

create or replace function public.mark_subscription_cashfree_order_unknown_v1(
  p_subscription_order_id uuid, p_provider_order_id text, p_safe_error_code text
) returns void language plpgsql security definer set search_path = pg_catalog, finance as $$
begin
  update finance.payment_orders set provider_order_id = coalesce(provider_order_id, p_provider_order_id),
    payment_status = 'creation_unknown', last_safe_error_code = left(p_safe_error_code, 120),
    next_reconcile_at = clock_timestamp() + interval '15 seconds', updated_at = clock_timestamp()
  where subscription_order_id = p_subscription_order_id and payment_status in ('created', 'creation_unknown');
  update finance.subscription_orders set checkout_status = 'pending', updated_at = clock_timestamp()
  where id = p_subscription_order_id and checkout_status = 'created';
end;
$$;

create or replace function public.get_subscription_reconciliation_context_v1(p_subscription_order_id uuid)
returns jsonb language sql security definer set search_path = pg_catalog, finance as $$
  select jsonb_build_object('orderId', so.id, 'providerId', so.provider_id,
    'paymentOrderId', po.id, 'providerOrderId', po.provider_order_id,
    'checkoutStatus', so.checkout_status, 'applicationStatus', so.application_status,
    'paymentStatus', po.payment_status, 'paymentSessionId', po.payment_session_id,
    'expiresAt', so.expires_at, 'amountPaise', po.amount_paise, 'currency', po.currency)
  from finance.subscription_orders so join finance.payment_orders po on po.subscription_order_id = so.id
  where so.id = p_subscription_order_id;
$$;

create or replace function public.find_subscription_by_provider_order_v1(p_provider_order_id text)
returns uuid language sql security definer set search_path = pg_catalog, finance as $$
  select subscription_order_id from finance.payment_orders
  where purpose = 'subscription' and provider_order_id = p_provider_order_id;
$$;

create or replace function public.finalize_subscription_payment_v1(
  p_subscription_order_id uuid, p_provider_order_id text, p_provider_payment_id text,
  p_paid_amount_paise bigint, p_currency text, p_paid_at timestamptz, p_source text
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, app, finance, ops
as $$
declare v_order finance.subscription_orders%rowtype; v_payment finance.payment_orders%rowtype;
declare v_ent app.merchant_entitlements%rowtype; v_plan app.subscription_plans%rowtype;
declare v_start timestamptz; v_expiry timestamptz; v_invoice finance.subscription_invoices%rowtype;
declare v_duplicate boolean := false;
begin
  select * into v_order from finance.subscription_orders where id = p_subscription_order_id for update;
  if v_order.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v_payment from finance.payment_orders where subscription_order_id = v_order.id for update;
  if v_payment.provider_order_id is distinct from p_provider_order_id then raise exception 'PROVIDER_ORDER_MISMATCH'; end if;
  if p_paid_amount_paise <> v_order.total_amount_paise or p_currency <> v_order.currency then
    update finance.subscription_orders set application_status = 'review_required', checkout_status = 'closed', updated_at = clock_timestamp() where id = v_order.id;
    insert into finance.subscription_payment_reviews(provider_id, subscription_order_id, reason, safe_details)
    values (v_order.provider_id, v_order.id, 'amount_mismatch', jsonb_build_object('receivedAmountPaise', p_paid_amount_paise))
    on conflict (subscription_order_id) do nothing;
    return public.get_merchant_subscription_v1(v_order.provider_id);
  end if;
  insert into finance.payment_attempts(payment_order_id, provider_payment_id, status, amount_paise, currency, paid_at, source)
  values (v_payment.id, p_provider_payment_id, 'succeeded', p_paid_amount_paise, p_currency, p_paid_at, p_source)
  on conflict (payment_order_id, provider_payment_id) do update set status = 'succeeded';
  update finance.payment_orders set payment_status = 'succeeded', paid_at = coalesce(paid_at, p_paid_at),
    fulfilment_status = 'not_applicable', updated_at = clock_timestamp() where id = v_payment.id;
  if v_order.application_status = 'applied' then
    return public.get_merchant_subscription_v1(v_order.provider_id);
  end if;
  if clock_timestamp() > v_order.expires_at then
    update finance.subscription_orders set checkout_status = 'closed', application_status = 'review_required', updated_at = clock_timestamp() where id = v_order.id;
    insert into finance.subscription_payment_reviews(provider_id, subscription_order_id, reason)
    values (v_order.provider_id, v_order.id, 'late_success') on conflict (subscription_order_id) do nothing;
    return public.get_merchant_subscription_v1(v_order.provider_id);
  end if;
  select exists(select 1 from finance.subscription_orders s where s.provider_id = v_order.provider_id
    and s.id <> v_order.id and s.application_status = 'applied' and s.applied_at >= v_order.created_at) into v_duplicate;
  if v_duplicate then
    update finance.subscription_orders set checkout_status = 'closed', application_status = 'refund_required', updated_at = clock_timestamp() where id = v_order.id;
    insert into finance.subscription_payment_reviews(provider_id, subscription_order_id, reason, status)
    values (v_order.provider_id, v_order.id, 'duplicate_success', 'refund_required') on conflict (subscription_order_id) do nothing;
    return public.get_merchant_subscription_v1(v_order.provider_id);
  end if;
  select * into v_plan from app.subscription_plans where id = v_order.plan_id;
  select * into v_ent from app.merchant_entitlements where provider_id = v_order.provider_id for update;
  if v_ent.provider_id is not null and v_ent.status in ('active', 'grace') then
    v_start := greatest(v_ent.expires_at, v_ent.starts_at);
    v_expiry := v_ent.expires_at + make_interval(days => v_plan.duration_days);
  else
    v_start := clock_timestamp();
    v_expiry := v_start + make_interval(days => v_plan.duration_days);
  end if;
  insert into app.merchant_entitlements(provider_id, plan_id, status, source, starts_at, expires_at, grace_ends_at,
    last_subscription_order_id, version)
  values (v_order.provider_id, v_order.plan_id, 'active', 'paid', v_start, v_expiry, v_expiry + interval '5 days', v_order.id, 1)
  on conflict (provider_id) do update set plan_id = excluded.plan_id, status = 'active', source = 'paid',
    starts_at = excluded.starts_at, expires_at = excluded.expires_at, grace_ends_at = excluded.grace_ends_at,
    frozen_at = null, deletion_scheduled_at = null, last_subscription_order_id = excluded.last_subscription_order_id,
    version = app.merchant_entitlements.version + 1, updated_at = clock_timestamp();
  update finance.subscription_orders set checkout_status = 'closed', application_status = 'applied',
    applied_at = clock_timestamp(), updated_at = clock_timestamp() where id = v_order.id;
  insert into finance.subscription_invoices(provider_id, subscription_order_id, invoice_number,
    base_amount_paise, tax_amount_paise, total_amount_paise, currency, billing_snapshot, plan_snapshot, is_test)
  values (v_order.provider_id, v_order.id,
    'CALUP-' || case when v_plan.is_test then 'SBX-' else '' end || to_char(clock_timestamp(), 'YYYY') || '-' ||
      lpad(nextval('finance.subscription_invoice_number_seq')::text, 8, '0'),
    v_order.base_amount_paise, v_order.tax_amount_paise, v_order.total_amount_paise, v_order.currency,
    v_order.billing_snapshot, v_order.plan_snapshot, v_plan.is_test)
  on conflict (subscription_order_id) do nothing returning * into v_invoice;
  insert into ops.audit_events(provider_id, aggregate_type, aggregate_id, action, actor_type, safe_metadata)
  values (v_order.provider_id, 'subscription_order', v_order.id, 'subscription.entitlement_applied', 'cashfree',
    jsonb_build_object('expiresAt', v_expiry, 'invoiceId', v_invoice.id));
  return public.get_merchant_subscription_v1(v_order.provider_id);
end;
$$;

create or replace function public.claim_subscription_reconciliation_v1(p_limit integer default 25)
returns setof uuid language sql security definer set search_path = pg_catalog, finance as $$
  with due as (
    select po.id from finance.payment_orders po
    where po.purpose = 'subscription' and po.payment_path = 'cashfree' and po.provider_order_id is not null
      and po.payment_status in ('creation_unknown', 'pending', 'closed_unpaid')
      and po.next_reconcile_at <= clock_timestamp()
    order by po.next_reconcile_at for update skip locked limit greatest(1, least(p_limit, 100))
  ), claimed as (
    update finance.payment_orders po set reconcile_attempt_count = reconcile_attempt_count + 1,
      next_reconcile_at = clock_timestamp() + make_interval(secs => least(600, 30 * (po.reconcile_attempt_count + 1))),
      updated_at = clock_timestamp() from due where po.id = due.id returning po.subscription_order_id
  ) select subscription_order_id from claimed;
$$;

create or replace function public.expire_subscription_orders_v1(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = pg_catalog, finance as $$
declare v_count integer;
begin
  with due as (select id from finance.subscription_orders where checkout_status in ('created', 'pending')
      and expires_at <= clock_timestamp() order by expires_at for update skip locked limit greatest(1, least(p_limit, 1000))),
  changed as (update finance.subscription_orders s set checkout_status = 'expired', updated_at = clock_timestamp()
    from due where s.id = due.id returning s.id)
  update finance.payment_orders p set payment_status = 'closed_unpaid', updated_at = clock_timestamp()
  where p.subscription_order_id in (select id from changed) and p.payment_status in ('created', 'pending', 'creation_failed');
  get diagnostics v_count = row_count; return v_count;
end;
$$;

create or replace function public.issue_access_code_admin_v1(
  p_code text, p_provider_id uuid, p_duration_days integer, p_valid_until timestamptz, p_reason text
) returns uuid language plpgsql security definer set search_path = pg_catalog, app, extensions as $$
declare v_id uuid;
begin
  if char_length(btrim(p_code)) < 8 then raise exception 'INVALID_CODE'; end if;
  insert into app.access_codes(code_hash, code_hint, bound_provider_id, duration_days, valid_until, reason)
  values (encode(extensions.digest(upper(btrim(p_code)), 'sha256'), 'hex'), right(upper(btrim(p_code)), 4),
    p_provider_id, p_duration_days, p_valid_until, p_reason) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.redeem_access_code_v1(p_provider_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, app, ops, extensions as $$
declare v_code app.access_codes%rowtype; v_ent app.merchant_entitlements%rowtype;
declare v_start timestamptz; v_expiry timestamptz; v_plan_id uuid;
begin
  select * into v_code from app.access_codes
  where code_hash = encode(extensions.digest(upper(btrim(p_code)), 'sha256'), 'hex') for update;
  if v_code.id is null then raise exception 'INVALID_ACCESS_CODE'; end if;
  if v_code.status <> 'active' or clock_timestamp() < v_code.valid_from or clock_timestamp() >= v_code.valid_until
    or v_code.redemption_count >= v_code.max_redemptions then raise exception 'ACCESS_CODE_UNAVAILABLE'; end if;
  if v_code.bound_provider_id is not null and v_code.bound_provider_id <> p_provider_id then raise exception 'ACCESS_CODE_UNAVAILABLE'; end if;
  if exists(select 1 from app.access_code_redemptions where access_code_id = v_code.id and provider_id = p_provider_id) then
    raise exception 'ACCESS_CODE_ALREADY_REDEEMED';
  end if;
  select id into v_plan_id from app.subscription_plans where is_active order by is_test desc, created_at limit 1;
  select * into v_ent from app.merchant_entitlements where provider_id = p_provider_id for update;
  if v_ent.provider_id is not null and v_ent.status in ('active', 'grace') then
    v_start := v_ent.expires_at; v_expiry := v_ent.expires_at + make_interval(days => v_code.duration_days);
  else v_start := clock_timestamp(); v_expiry := v_start + make_interval(days => v_code.duration_days); end if;
  insert into app.merchant_entitlements(provider_id, plan_id, status, source, starts_at, expires_at, grace_ends_at)
  values (p_provider_id, v_plan_id, 'active', 'access_code', v_start, v_expiry, v_expiry + interval '5 days')
  on conflict (provider_id) do update set plan_id = excluded.plan_id, status = 'active', source = 'access_code',
    starts_at = excluded.starts_at, expires_at = excluded.expires_at, grace_ends_at = excluded.grace_ends_at,
    frozen_at = null, deletion_scheduled_at = null, version = app.merchant_entitlements.version + 1,
    updated_at = clock_timestamp();
  insert into app.access_code_redemptions(access_code_id, provider_id, entitlement_starts_at, entitlement_expires_at)
  values (v_code.id, p_provider_id, v_start, v_expiry);
  update app.access_codes set redemption_count = redemption_count + 1,
    status = case when redemption_count + 1 >= max_redemptions then 'exhausted' else status end,
    updated_at = clock_timestamp() where id = v_code.id;
  insert into ops.audit_events(provider_id, aggregate_type, aggregate_id, action, actor_type, safe_metadata)
  values (p_provider_id, 'access_code', v_code.id, 'access_code.redeemed', 'merchant',
    jsonb_build_object('durationDays', v_code.duration_days, 'expiresAt', v_expiry));
  return public.get_merchant_subscription_v1(p_provider_id);
end;
$$;

create or replace function public.get_subscription_document_v1(p_provider_id uuid, p_document_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, finance as $$
declare v_result jsonb;
begin
  select jsonb_build_object('id', i.id, 'type', 'invoice', 'number', i.invoice_number,
    'baseAmountPaise', i.base_amount_paise, 'taxAmountPaise', i.tax_amount_paise,
    'totalAmountPaise', i.total_amount_paise, 'currency', i.currency,
    'billingSnapshot', i.billing_snapshot, 'planSnapshot', i.plan_snapshot,
    'subscriptionOrderId', i.subscription_order_id, 'cashfreeOrderId', po.provider_order_id,
    'cashfreePaymentId', (select pa.provider_payment_id from finance.payment_attempts pa
      where pa.payment_order_id = po.id and pa.status = 'succeeded'
      order by pa.paid_at desc nulls last, pa.created_at desc limit 1),
    'paidAt', po.paid_at, 'issuedAt', i.issued_at, 'isTest', i.is_test) into v_result
  from finance.subscription_invoices i
  left join finance.payment_orders po on po.subscription_order_id = i.subscription_order_id
  where i.id = p_document_id and i.provider_id = p_provider_id;
  if v_result is null then
    select jsonb_build_object('id', c.id, 'type', 'credit_note', 'number', c.credit_note_number,
      'amountPaise', c.amount_paise, 'currency', 'INR', 'reason', c.reason,
      'billingSnapshot', i.billing_snapshot, 'planSnapshot', i.plan_snapshot,
      'subscriptionOrderId', i.subscription_order_id, 'cashfreeOrderId', po.provider_order_id,
      'cashfreePaymentId', (select pa.provider_payment_id from finance.payment_attempts pa
        where pa.payment_order_id = po.id and pa.status = 'succeeded'
        order by pa.paid_at desc nulls last, pa.created_at desc limit 1),
      'paidAt', po.paid_at, 'issuedAt', c.issued_at, 'isTest', c.is_test) into v_result
    from finance.subscription_credit_notes c
    join finance.subscription_invoices i on i.id = c.invoice_id
    left join finance.payment_orders po on po.subscription_order_id = i.subscription_order_id
    where c.id = p_document_id and c.provider_id = p_provider_id;
  end if;
  return v_result;
end;
$$;

create or replace function app.enforce_booking_entitlement_v1()
returns trigger language plpgsql security definer set search_path = pg_catalog, app as $$
declare v_ent app.merchant_entitlements%rowtype;
begin
  select * into v_ent from app.merchant_entitlements where provider_id = new.provider_id;
  if v_ent.provider_id is null or not (
    (v_ent.status = 'active' and clock_timestamp() < v_ent.expires_at)
    or (v_ent.status in ('active', 'grace') and clock_timestamp() < v_ent.grace_ends_at)
  ) then raise exception 'SUBSCRIPTION_REQUIRED'; end if;
  return new;
end;
$$;

drop trigger if exists booking_attempt_entitlement_guard_v1 on app.booking_attempts;
create trigger booking_attempt_entitlement_guard_v1 before insert on app.booking_attempts
for each row execute function app.enforce_booking_entitlement_v1();

alter table app.subscription_plans enable row level security;
alter table app.merchant_entitlements enable row level security;
alter table app.merchant_billing_profiles enable row level security;
alter table app.access_codes enable row level security;
alter table app.access_code_redemptions enable row level security;
alter table app.service_credits enable row level security;
alter table finance.subscription_orders enable row level security;
alter table finance.subscription_invoices enable row level security;
alter table finance.subscription_credit_notes enable row level security;
alter table finance.subscription_payment_reviews enable row level security;

revoke all on app.subscription_plans, app.merchant_entitlements, app.merchant_billing_profiles,
  app.access_codes, app.access_code_redemptions, app.service_credits from anon, authenticated;
revoke all on finance.subscription_orders, finance.subscription_invoices,
  finance.subscription_credit_notes, finance.subscription_payment_reviews from anon, authenticated;
grant select, insert, update on app.subscription_plans, app.merchant_entitlements, app.merchant_billing_profiles,
  app.access_codes, app.access_code_redemptions, app.service_credits to service_role;
grant select, insert, update on finance.subscription_orders, finance.subscription_invoices,
  finance.subscription_credit_notes, finance.subscription_payment_reviews to service_role;
grant usage, select on sequence finance.subscription_invoice_number_seq to service_role;

revoke all on function public.issue_access_code_admin_v1(text, uuid, integer, timestamptz, text) from public, anon, authenticated;
grant execute on function public.issue_access_code_admin_v1(text, uuid, integer, timestamptz, text) to service_role;

do $$
declare fn text;
begin
  foreach fn in array array[
    'transition_subscription_lifecycle_v1', 'get_merchant_subscription_v1',
    'update_merchant_billing_profile_v1', 'create_subscription_order_v1',
    'mark_subscription_cashfree_order_created_v1', 'mark_subscription_cashfree_order_unknown_v1',
    'get_subscription_reconciliation_context_v1', 'find_subscription_by_provider_order_v1',
    'finalize_subscription_payment_v1', 'claim_subscription_reconciliation_v1',
    'expire_subscription_orders_v1', 'redeem_access_code_v1', 'get_subscription_document_v1'
  ] loop
    execute format('revoke all on function public.%I from public, anon, authenticated', fn);
  end loop;
end $$;

grant execute on function public.transition_subscription_lifecycle_v1(uuid) to service_role;
grant execute on function public.get_merchant_subscription_v1(uuid) to service_role;
grant execute on function public.update_merchant_billing_profile_v1(uuid, bigint, text, text, text, text, text, text, text) to service_role;
grant execute on function public.create_subscription_order_v1(uuid, uuid, text, text, text) to service_role;
grant execute on function public.mark_subscription_cashfree_order_created_v1(uuid, text, text) to service_role;
grant execute on function public.mark_subscription_cashfree_order_unknown_v1(uuid, text, text) to service_role;
grant execute on function public.get_subscription_reconciliation_context_v1(uuid) to service_role;
grant execute on function public.find_subscription_by_provider_order_v1(text) to service_role;
grant execute on function public.finalize_subscription_payment_v1(uuid, text, text, bigint, text, timestamptz, text) to service_role;
grant execute on function public.claim_subscription_reconciliation_v1(integer) to service_role;
grant execute on function public.expire_subscription_orders_v1(integer) to service_role;
grant execute on function public.redeem_access_code_v1(uuid, text) to service_role;
grant execute on function public.get_subscription_document_v1(uuid, uuid) to service_role;

commit;
