-- Close an unpaid hosted-checkout attempt and release its slot immediately.
-- A later verified success remains valid financial truth, but the existing
-- finalizer will treat it as unfulfilled and open manual review/refund.

create or replace function public.abandon_cashfree_checkout_v1(
  p_attempt_id uuid,
  p_attempt_token_hash text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, app, finance, ops
as $$
declare
  v_order finance.payment_orders%rowtype;
  v_attempt app.booking_attempts%rowtype;
  v_provider_slug text;
  v_appointment_id uuid;
  v_case_id uuid;
begin
  -- Match the finalizer's lock order: payment order first, booking attempt next.
  select po.* into v_order
  from finance.payment_orders po
  join app.booking_attempts ba on ba.id = po.booking_attempt_id
  where ba.id = p_attempt_id and ba.attempt_token_hash = p_attempt_token_hash
  for update of po;

  if not found then return null; end if;

  select * into v_attempt
  from app.booking_attempts
  where id = v_order.booking_attempt_id
  for update;

  select slug into v_provider_slug from public.providers where id = v_attempt.provider_id;
  select id into v_appointment_id from app.appointments where payment_order_id = v_order.id;
  select id into v_case_id from finance.payment_resolution_cases where payment_order_id = v_order.id;

  if v_order.payment_status in ('pending', 'created') then
    update finance.payment_orders
    set payment_status = 'closed_unpaid',
        last_safe_error_code = 'CUSTOMER_CHECKOUT_ENDED',
        updated_at = clock_timestamp()
    where id = v_order.id
    returning * into v_order;

    update app.slot_allocations
    set status = 'released', release_reason = 'customer_checkout_ended', released_at = clock_timestamp()
    where attempt_id = v_attempt.id and status = 'held';

    update app.booking_attempts
    set status = 'released', released_at = clock_timestamp()
    where id = v_attempt.id and status = 'hold_active'
    returning * into v_attempt;

    insert into ops.audit_events(provider_id, aggregate_type, aggregate_id, action, actor_type)
    values (v_order.provider_id, 'payment_order', v_order.id, 'payment.checkout_ended_unpaid', 'customer');
  end if;

  return jsonb_build_object(
    'attemptId', v_attempt.id,
    'attemptStatus', v_attempt.status,
    'paymentOrderId', v_order.id,
    'paymentStatus', v_order.payment_status,
    'fulfilmentStatus', v_order.fulfilment_status,
    'paymentSessionId', v_order.payment_session_id,
    'amountPaise', v_order.amount_paise,
    'currency', v_order.currency,
    'holdExpiresAt', v_attempt.hold_expires_at,
    'remainingSeconds', greatest(0, floor(extract(epoch from (v_attempt.hold_expires_at - clock_timestamp())))::integer),
    'appointmentId', v_appointment_id,
    'resolutionCaseId', v_case_id,
    'providerSlug', v_provider_slug
  );
end;
$$;

revoke all on function public.abandon_cashfree_checkout_v1(uuid, text) from public, anon, authenticated;
grant execute on function public.abandon_cashfree_checkout_v1(uuid, text) to service_role;

comment on function public.abandon_cashfree_checkout_v1 is
  'Atomically closes an unpaid checkout and releases its active slot hold; late success remains recoverable by the payment finalizer.';
