-- Replace bulk cancellation with one-period cancellation and compact later periods.
drop function if exists public.cancel_advance_subscription_v1(uuid);

create or replace function public.get_subscription_cancellation_v1(p_provider_id uuid)
returns jsonb language sql security definer set search_path = pg_catalog, app, finance as $$
  select jsonb_build_object(
    'accessEndsAt', e.expires_at,
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
      'accessEndsAtAfterCancellation', e.expires_at - (x.ends_at - x.starts_at),
      'refundStatus', r.status) order by x.starts_at)
      from finance.subscription_periods x
      join finance.subscription_invoices i on i.id = x.invoice_id
      left join finance.refunds_v1 r on r.id = x.refund_id
      where x.provider_id = p_provider_id), '[]'::jsonb)
  )
  from app.merchant_entitlements e where e.provider_id = p_provider_id;
$$;

create or replace function public.cancel_subscription_period_v1(p_provider_id uuid, p_period_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, app, finance, ops as $$
declare v_ent app.merchant_entitlements%rowtype; v_period record; v_refund_id uuid;
declare v_duration interval; v_new_expiry timestamptz; v_latest_order uuid;
begin
  select * into v_ent from app.merchant_entitlements where provider_id = p_provider_id for update;
  if v_ent.provider_id is null then raise exception 'SUBSCRIPTION_NOT_FOUND'; end if;

  select sp.*, i.total_amount_paise, i.invoice_number, po.id payment_order_id
  into v_period
  from finance.subscription_periods sp
  join finance.subscription_invoices i on i.id = sp.invoice_id
  join finance.payment_orders po on po.subscription_order_id = sp.subscription_order_id
  where sp.id = p_period_id and sp.provider_id = p_provider_id
    and sp.status = 'scheduled' and sp.starts_at > statement_timestamp()
  for update of sp;
  if v_period.id is null then raise exception 'PERIOD_NOT_CANCELLABLE'; end if;

  v_duration := v_period.ends_at - v_period.starts_at;
  v_new_expiry := v_ent.expires_at - v_duration;

  insert into finance.refunds_v1(payment_order_id, amount_paise, currency, reason, status, idempotency_key)
  values (v_period.payment_order_id, v_period.total_amount_paise, 'INR',
    'Unused prepaid Calup subscription period cancelled by merchant', 'requested',
    'subscription-cancel:' || v_period.id::text)
  on conflict (idempotency_key) do update set updated_at = finance.refunds_v1.updated_at
  returning id into v_refund_id;

  update finance.subscription_periods set status = 'refund_pending', refund_id = v_refund_id,
    cancelled_at = statement_timestamp(), updated_at = statement_timestamp()
  where id = v_period.id;

  -- Removing a middle period must not create a gap in otherwise continuous access.
  update finance.subscription_periods
  set starts_at = starts_at - v_duration, ends_at = ends_at - v_duration,
      updated_at = statement_timestamp()
  where provider_id = p_provider_id and status = 'scheduled' and starts_at >= v_period.ends_at;

  select subscription_order_id into v_latest_order from finance.subscription_periods
  where provider_id = p_provider_id and status in ('active', 'scheduled')
  order by ends_at desc limit 1;

  update app.merchant_entitlements set starts_at = least(starts_at, statement_timestamp()),
    expires_at = v_new_expiry, grace_ends_at = v_new_expiry + interval '5 days',
    last_subscription_order_id = v_latest_order,
    cancellation_requested_at = statement_timestamp(), version = version + 1,
    updated_at = statement_timestamp()
  where provider_id = p_provider_id;

  insert into ops.audit_events(provider_id, aggregate_type, aggregate_id, action, actor_type, safe_metadata)
  values (p_provider_id, 'subscription_period', p_period_id, 'subscription.period_cancelled', 'merchant',
    jsonb_build_object('accessEndsAt', v_new_expiry, 'refundId', v_refund_id,
      'invoiceNumber', v_period.invoice_number));
  return jsonb_build_object('refundId', v_refund_id, 'periodId', p_period_id,
    'accessEndsAt', v_new_expiry, 'amountPaise', v_period.total_amount_paise);
end;
$$;

revoke all on function public.cancel_subscription_period_v1(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_subscription_cancellation_v1(uuid) from public, anon, authenticated;
grant execute on function public.cancel_subscription_period_v1(uuid, uuid) to service_role;
grant execute on function public.get_subscription_cancellation_v1(uuid) to service_role;
