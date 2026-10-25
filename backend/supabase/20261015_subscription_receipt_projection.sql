-- Enrich merchant-owned subscription documents for the receipt popup.
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
