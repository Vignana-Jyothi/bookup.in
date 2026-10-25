-- Token-protected customer booking receipt for fulfilled Cashfree appointments.

create or replace function public.get_booking_attempt_v1(
  p_attempt_id uuid,
  p_attempt_token_hash text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app, finance
as $$
declare
  v_attempt app.booking_attempts%rowtype;
  v_order finance.payment_orders%rowtype;
  v_appointment app.appointments%rowtype;
  v_provider public.providers%rowtype;
  v_service public.services%rowtype;
  v_case_id uuid;
  v_provider_payment_id text;
  v_timezone text;
begin
  select * into v_attempt
  from app.booking_attempts
  where id = p_attempt_id and attempt_token_hash = p_attempt_token_hash;
  if not found then return null; end if;

  select * into v_order from finance.payment_orders where booking_attempt_id = v_attempt.id;
  select * into v_appointment from app.appointments where booking_attempt_id = v_attempt.id;
  select * into v_provider from public.providers where id = v_attempt.provider_id;
  select * into v_service from public.services where id = v_attempt.service_id;
  select id into v_case_id from finance.payment_resolution_cases where booking_attempt_id = v_attempt.id;
  select provider_payment_id into v_provider_payment_id
  from finance.payment_attempts
  where payment_order_id = v_order.id and status = 'succeeded'
  order by paid_at desc nulls last, created_at desc
  limit 1;

  v_timezone := coalesce(nullif(v_provider.timezone, ''), 'Asia/Kolkata');

  return jsonb_build_object(
    'attemptId', v_attempt.id,
    'attemptStatus', v_attempt.status,
    'paymentOrderId', v_order.id,
    'providerOrderId', v_order.provider_order_id,
    'paymentStatus', v_order.payment_status,
    'fulfilmentStatus', v_order.fulfilment_status,
    'paymentSessionId', v_order.payment_session_id,
    'amountPaise', v_order.amount_paise,
    'currency', v_order.currency,
    'holdExpiresAt', v_attempt.hold_expires_at,
    'remainingSeconds', greatest(0, floor(extract(epoch from (v_attempt.hold_expires_at - clock_timestamp())))::integer),
    'appointmentId', v_appointment.id,
    'resolutionCaseId', v_case_id,
    'providerSlug', v_provider.slug,
    'receipt', case
      when v_order.payment_status = 'succeeded'
        and v_order.fulfilment_status = 'fulfilled'
        and v_appointment.id is not null
      then jsonb_build_object(
        'bookingId', v_appointment.id,
        'merchantName', coalesce(nullif(v_provider.business_name, ''), v_provider.name),
        'serviceName', v_service.name,
        'customerName', v_attempt.customer_name,
        'customerPhone', v_attempt.customer_phone,
        'startsAt', v_appointment.starts_at,
        'endsAt', v_appointment.ends_at,
        'timezone', v_timezone,
        'meetingType', v_appointment.meeting_type,
        'amountPaise', v_order.amount_paise,
        'currency', v_order.currency,
        'paidAt', v_order.paid_at,
        'cashfreeOrderId', v_order.provider_order_id,
        'cashfreePaymentId', v_provider_payment_id
      )
      else null
    end
  );
end;
$$;

revoke all on function public.get_booking_attempt_v1(uuid, text) from public, anon, authenticated;
grant execute on function public.get_booking_attempt_v1(uuid, text) to service_role;

comment on function public.get_booking_attempt_v1 is
  'Token-protected Cashfree attempt status. Includes receipt data only for succeeded and fulfilled appointments.';
