-- Keep successful subscription refunds terminal under stale reconciliation results.
create or replace function public.mark_subscription_refund_v1(
  p_refund_id uuid, p_status text, p_provider_refund_id text default null, p_safe_error text default null
) returns boolean language plpgsql security definer set search_path = pg_catalog, finance, ops as $$
declare v_period finance.subscription_periods%rowtype; v_invoice finance.subscription_invoices%rowtype; v_current_status text;
begin
  if p_status not in ('submitted', 'processing', 'succeeded', 'failed', 'review_required', 'rejected') then
    raise exception 'INVALID_REFUND_STATUS';
  end if;
  -- Serialize competing worker/request observations. Success is authoritative and
  -- must never regress when an older network request finishes with an error.
  select status into v_current_status from finance.refunds_v1
  where id = p_refund_id for update;
  if not found then return false; end if;
  if v_current_status = 'succeeded' then return true; end if;

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
