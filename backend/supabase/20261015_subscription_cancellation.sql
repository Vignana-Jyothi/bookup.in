-- Track each paid access period so unused advance renewals can be cancelled and refunded safely.
create sequence if not exists finance.subscription_credit_note_number_seq;

alter table app.merchant_entitlements
  add column if not exists cancellation_requested_at timestamptz;

alter table finance.refunds_v1
  add column if not exists next_reconcile_at timestamptz not null default now(),
  add column if not exists reconcile_attempt_count integer not null default 0 check (reconcile_attempt_count >= 0),
  add column if not exists last_safe_error text;

alter table finance.subscription_credit_notes
  add column if not exists refund_id uuid unique references finance.refunds_v1(id) on delete restrict;

create table if not exists finance.subscription_periods (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete restrict,
  subscription_order_id uuid not null unique references finance.subscription_orders(id) on delete restrict,
  invoice_id uuid not null unique references finance.subscription_invoices(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null check (status in ('scheduled', 'active', 'completed', 'refund_pending', 'refunded', 'refund_review')),
  refund_id uuid unique references finance.refunds_v1(id) on delete restrict,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists subscription_periods_provider_timeline_idx
  on finance.subscription_periods(provider_id, starts_at, ends_at);
create index if not exists subscription_periods_refund_status_idx
  on finance.subscription_periods(status, refund_id) where refund_id is not null;
create index if not exists refunds_v1_subscription_reconcile_idx
  on finance.refunds_v1(status, next_reconcile_at)
  where status in ('requested', 'submitted', 'processing');

alter table finance.subscription_periods enable row level security;
revoke all on finance.subscription_periods from public, anon, authenticated;
grant select, insert, update on finance.subscription_periods to service_role;

-- Existing applied renewals form the paid tail of the current entitlement.
with ranked as (
  select so.id subscription_order_id, so.provider_id, i.id invoice_id,
    e.expires_at final_expiry, p.duration_days,
    row_number() over (partition by so.provider_id order by so.applied_at, so.id) rn,
    count(*) over (partition by so.provider_id) total_count
  from finance.subscription_orders so
  join finance.subscription_invoices i on i.subscription_order_id = so.id
  join app.merchant_entitlements e on e.provider_id = so.provider_id
  join app.subscription_plans p on p.id = so.plan_id
  where so.application_status = 'applied'
)
insert into finance.subscription_periods(provider_id, subscription_order_id, invoice_id, starts_at, ends_at, status)
select provider_id, subscription_order_id, invoice_id,
  final_expiry - make_interval(days => duration_days * (total_count - rn + 1)::integer),
  final_expiry - make_interval(days => duration_days * (total_count - rn)::integer),
  case
    when final_expiry - make_interval(days => duration_days * (total_count - rn + 1)::integer) > statement_timestamp() then 'scheduled'
    when final_expiry - make_interval(days => duration_days * (total_count - rn)::integer) <= statement_timestamp() then 'completed'
    else 'active'
  end
from ranked
on conflict (subscription_order_id) do nothing;

create or replace function finance.create_subscription_period_from_invoice_v1()
returns trigger language plpgsql security definer set search_path = pg_catalog, app, finance as $$
declare v_ent app.merchant_entitlements%rowtype; v_days integer;
begin
  select * into v_ent from app.merchant_entitlements where provider_id = new.provider_id;
  select duration_days into v_days from app.subscription_plans
  where id = (select plan_id from finance.subscription_orders where id = new.subscription_order_id);
  insert into finance.subscription_periods(provider_id, subscription_order_id, invoice_id, starts_at, ends_at, status)
  values (new.provider_id, new.subscription_order_id, new.id,
    v_ent.expires_at - make_interval(days => v_days), v_ent.expires_at,
    case when v_ent.expires_at - make_interval(days => v_days) > statement_timestamp() then 'scheduled' else 'active' end)
  on conflict (subscription_order_id) do nothing;
  return new;
end;
$$;

drop trigger if exists subscription_invoice_period_v1 on finance.subscription_invoices;
create trigger subscription_invoice_period_v1 after insert on finance.subscription_invoices
for each row execute function finance.create_subscription_period_from_invoice_v1();

create or replace function public.transition_subscription_periods_v1()
returns integer language plpgsql security definer set search_path = pg_catalog, finance as $$
declare v_count integer;
begin
  update finance.subscription_periods
  set status = case when ends_at <= statement_timestamp() then 'completed' else 'active' end,
      updated_at = statement_timestamp()
  where status in ('scheduled', 'active')
    and (ends_at <= statement_timestamp() or (starts_at <= statement_timestamp() and ends_at > statement_timestamp()))
    and status is distinct from case when ends_at <= statement_timestamp() then 'completed' else 'active' end;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.get_subscription_cancellation_v1(p_provider_id uuid)
returns jsonb language sql security definer set search_path = pg_catalog, app, finance as $$
  select jsonb_build_object(
    'accessEndsAt', e.expires_at,
    'cancelEffectiveAt', coalesce(
      (select x.ends_at from finance.subscription_periods x where x.provider_id = p_provider_id
        and x.status = 'active' and x.starts_at <= statement_timestamp() and x.ends_at > statement_timestamp()
        order by x.starts_at limit 1),
      (select min(x.starts_at) from finance.subscription_periods x where x.provider_id = p_provider_id
        and x.status = 'scheduled' and x.starts_at > statement_timestamp()),
      e.expires_at),
    'requestedAt', e.cancellation_requested_at,
    'canCancel', exists(select 1 from finance.subscription_periods x
      where x.provider_id = p_provider_id and x.status = 'scheduled' and x.starts_at > statement_timestamp()),
    'refundablePeriodCount', (select count(*) from finance.subscription_periods x
      where x.provider_id = p_provider_id and x.status = 'scheduled' and x.starts_at > statement_timestamp()),
    'refundableAmountPaise', coalesce((select sum(i.total_amount_paise)
      from finance.subscription_periods x join finance.subscription_invoices i on i.id = x.invoice_id
      where x.provider_id = p_provider_id and x.status = 'scheduled' and x.starts_at > statement_timestamp()), 0),
    'refundPendingCount', (select count(*) from finance.subscription_periods x
      where x.provider_id = p_provider_id and x.status in ('refund_pending', 'refund_review')),
    'periods', coalesce((select jsonb_agg(jsonb_build_object(
      'id', x.id, 'startsAt', x.starts_at, 'endsAt', x.ends_at, 'status', x.status,
      'amountPaise', i.total_amount_paise, 'invoiceNumber', i.invoice_number,
      'refundStatus', r.status) order by x.starts_at)
      from finance.subscription_periods x
      join finance.subscription_invoices i on i.id = x.invoice_id
      left join finance.refunds_v1 r on r.id = x.refund_id
      where x.provider_id = p_provider_id), '[]'::jsonb)
  )
  from app.merchant_entitlements e where e.provider_id = p_provider_id;
$$;

create or replace function public.cancel_advance_subscription_v1(p_provider_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, app, finance, ops as $$
declare v_ent app.merchant_entitlements%rowtype; v_active finance.subscription_periods%rowtype;
declare v_keep_end timestamptz; v_period record; v_refund_id uuid; v_refund_ids jsonb := '[]'::jsonb;
begin
  select * into v_ent from app.merchant_entitlements where provider_id = p_provider_id for update;
  if v_ent.provider_id is null then raise exception 'SUBSCRIPTION_NOT_FOUND'; end if;

  select * into v_active from finance.subscription_periods
  where provider_id = p_provider_id and status = 'active'
    and starts_at <= statement_timestamp() and ends_at > statement_timestamp()
  order by starts_at limit 1 for update;

  if v_active.id is not null then
    v_keep_end := v_active.ends_at;
  else
    select min(starts_at) into v_keep_end from finance.subscription_periods
    where provider_id = p_provider_id and status = 'scheduled' and starts_at > statement_timestamp();
  end if;
  if v_keep_end is null then raise exception 'NO_ADVANCE_PERIODS'; end if;

  for v_period in
    select sp.*, i.total_amount_paise, i.invoice_number, po.id payment_order_id
    from finance.subscription_periods sp
    join finance.subscription_invoices i on i.id = sp.invoice_id
    join finance.payment_orders po on po.subscription_order_id = sp.subscription_order_id
    where sp.provider_id = p_provider_id and sp.status = 'scheduled' and sp.starts_at >= v_keep_end
    order by sp.starts_at for update of sp
  loop
    insert into finance.refunds_v1(payment_order_id, amount_paise, currency, reason, status, idempotency_key)
    values (v_period.payment_order_id, v_period.total_amount_paise, 'INR',
      'Unused prepaid Calup subscription period cancelled by merchant', 'requested',
      'subscription-cancel:' || v_period.id::text)
    on conflict (idempotency_key) do update set updated_at = finance.refunds_v1.updated_at
    returning id into v_refund_id;
    update finance.subscription_periods set status = 'refund_pending', refund_id = v_refund_id,
      cancelled_at = statement_timestamp(), updated_at = statement_timestamp() where id = v_period.id;
    v_refund_ids := v_refund_ids || jsonb_build_array(v_refund_id);
  end loop;
  if jsonb_array_length(v_refund_ids) = 0 then raise exception 'NO_ADVANCE_PERIODS'; end if;

  update app.merchant_entitlements set starts_at = least(starts_at, statement_timestamp()),
    expires_at = v_keep_end, grace_ends_at = v_keep_end + interval '5 days',
    last_subscription_order_id = v_active.subscription_order_id,
    cancellation_requested_at = statement_timestamp(), version = version + 1, updated_at = statement_timestamp()
  where provider_id = p_provider_id;
  update finance.subscription_orders set checkout_status = 'expired', updated_at = statement_timestamp()
  where provider_id = p_provider_id and checkout_status in ('created', 'pending');
  update finance.payment_orders set payment_status = 'closed_unpaid', updated_at = statement_timestamp()
  where subscription_order_id in (select id from finance.subscription_orders
    where provider_id = p_provider_id and checkout_status = 'expired')
    and payment_status in ('created', 'pending');
  insert into ops.audit_events(provider_id, aggregate_type, aggregate_id, action, actor_type, safe_metadata)
  values (p_provider_id, 'merchant_entitlement', p_provider_id, 'subscription.advance_periods_cancelled', 'merchant',
    jsonb_build_object('accessEndsAt', v_keep_end, 'refundCount', jsonb_array_length(v_refund_ids)));
  return jsonb_build_object('refundIds', v_refund_ids, 'accessEndsAt', v_keep_end);
end;
$$;

create or replace function public.get_subscription_refund_context_v1(p_refund_id uuid)
returns jsonb language sql security definer set search_path = pg_catalog, finance as $$
  select jsonb_build_object('refundId', r.id, 'providerId', po.provider_id,
    'providerOrderId', po.provider_order_id, 'amountPaise', r.amount_paise,
    'status', r.status, 'providerRefundId', r.provider_refund_id)
  from finance.refunds_v1 r join finance.payment_orders po on po.id = r.payment_order_id
  where r.id = p_refund_id and po.purpose = 'subscription';
$$;

create or replace function public.claim_subscription_refunds_v1(p_limit integer default 20)
returns setof uuid language sql security definer set search_path = pg_catalog, finance as $$
  with due as (
    select r.id from finance.refunds_v1 r join finance.payment_orders po on po.id = r.payment_order_id
    where po.purpose = 'subscription' and r.status in ('requested', 'submitted', 'processing')
      and r.next_reconcile_at <= statement_timestamp()
    order by r.next_reconcile_at for update skip locked limit greatest(1, least(p_limit, 100))
  ), changed as (
    update finance.refunds_v1 r set reconcile_attempt_count = r.reconcile_attempt_count + 1,
      next_reconcile_at = statement_timestamp() + make_interval(secs => least(1800, 30 * (r.reconcile_attempt_count + 1))),
      updated_at = statement_timestamp() from due where r.id = due.id returning r.id
  ) select id from changed;
$$;

create or replace function public.mark_subscription_refund_v1(
  p_refund_id uuid, p_status text, p_provider_refund_id text default null, p_safe_error text default null
) returns boolean language plpgsql security definer set search_path = pg_catalog, finance, ops as $$
declare v_period finance.subscription_periods%rowtype; v_invoice finance.subscription_invoices%rowtype;
begin
  if p_status not in ('submitted', 'processing', 'succeeded', 'failed', 'review_required', 'rejected') then
    raise exception 'INVALID_REFUND_STATUS';
  end if;
  update finance.refunds_v1 set status = p_status, provider_refund_id = coalesce(p_provider_refund_id, provider_refund_id),
    last_safe_error = left(p_safe_error, 200), updated_at = statement_timestamp()
  where id = p_refund_id;
  if not found then return false; end if;
  select * into v_period from finance.subscription_periods where refund_id = p_refund_id for update;
  if p_status = 'succeeded' and v_period.id is not null then
    update finance.subscription_periods set status = 'refunded', updated_at = statement_timestamp() where id = v_period.id;
    select * into v_invoice from finance.subscription_invoices where id = v_period.invoice_id;
    insert into finance.subscription_credit_notes(provider_id, invoice_id, refund_id, credit_note_number,
      amount_paise, reason, is_test)
    values (v_invoice.provider_id, v_invoice.id, p_refund_id,
      'CALUP-' || case when v_invoice.is_test then 'SBX-CN-' else 'CN-' end ||
      to_char(statement_timestamp(), 'YYYY') || '-' || lpad(nextval('finance.subscription_credit_note_number_seq')::text, 8, '0'),
      v_invoice.total_amount_paise, 'Unused prepaid subscription period cancelled', v_invoice.is_test)
    on conflict (refund_id) do nothing;
  elsif p_status in ('failed', 'review_required', 'rejected') and v_period.id is not null then
    update finance.subscription_periods set status = 'refund_review', updated_at = statement_timestamp() where id = v_period.id;
  end if;
  insert into ops.audit_events(provider_id, aggregate_type, aggregate_id, action, actor_type, safe_metadata)
  select po.provider_id, 'refund', r.id, 'subscription.refund_' || p_status, 'cashfree',
    jsonb_build_object('providerRefundId', p_provider_refund_id)
  from finance.refunds_v1 r join finance.payment_orders po on po.id = r.payment_order_id where r.id = p_refund_id;
  return true;
end;
$$;

revoke all on function public.transition_subscription_periods_v1() from public, anon, authenticated;
revoke all on function public.get_subscription_cancellation_v1(uuid) from public, anon, authenticated;
revoke all on function public.cancel_advance_subscription_v1(uuid) from public, anon, authenticated;
revoke all on function public.get_subscription_refund_context_v1(uuid) from public, anon, authenticated;
revoke all on function public.claim_subscription_refunds_v1(integer) from public, anon, authenticated;
revoke all on function public.mark_subscription_refund_v1(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.transition_subscription_periods_v1() to service_role;
grant execute on function public.get_subscription_cancellation_v1(uuid) to service_role;
grant execute on function public.cancel_advance_subscription_v1(uuid) to service_role;
grant execute on function public.get_subscription_refund_context_v1(uuid) to service_role;
grant execute on function public.claim_subscription_refunds_v1(integer) to service_role;
grant execute on function public.mark_subscription_refund_v1(uuid, text, text, text) to service_role;
