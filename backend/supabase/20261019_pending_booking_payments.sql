begin;

-- Reuse the existing durable SMS-verified, merchant-bound phone session.
-- This is a service-only reader; it never changes payment or slot ownership.
create or replace function public.get_verified_booking_payments_v1(
  p_hash text, p_slug text, p_attempt_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  verified jsonb;
  result jsonb;
begin
  verified := public.commerce_session_v1(p_hash, p_slug);
  if verified is null then raise exception 'AUTH_REQUIRED'; end if;

  if p_attempt_id is not null then
    select jsonb_build_object('attemptId', ba.id, 'providerId', ba.provider_id,
      'idempotencyKey', ba.idempotency_key, 'attemptTokenHash', ba.attempt_token_hash)
    into result
    from app.booking_attempts ba
    join finance.payment_orders po on po.booking_attempt_id = ba.id
    join public.commerce_contacts c on c.id = (verified->>'contactId')::uuid
    where ba.id = p_attempt_id and ba.provider_id = (verified->>'providerId')::uuid
      and ba.customer_phone = c.phone and c.provider_id = ba.provider_id
      and (po.payment_status in ('created', 'creation_unknown', 'pending')
        or (po.payment_status = 'succeeded' and po.fulfilment_status <> 'fulfilled')
        or ba.status = 'manual_review');
    if result is null then raise exception 'NOT_FOUND'; end if;
    return result; -- Credential source stays inside the server, never the HTTP response.
  end if;

  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb) into result
  from (
    select ba.created_at, jsonb_build_object('attemptId', ba.id,
      'serviceName', s.name, 'bookingDate', ba.booking_date, 'startTime', ba.start_time,
      'amountPaise', po.amount_paise, 'currency', po.currency,
      'paymentStatus', po.payment_status, 'attemptStatus', ba.status,
      'fulfilmentStatus', po.fulfilment_status, 'holdExpiresAt', ba.hold_expires_at) as item
    from app.booking_attempts ba
    join finance.payment_orders po on po.booking_attempt_id = ba.id
    join public.services s on s.id = ba.service_id
    join public.commerce_contacts c on c.id = (verified->>'contactId')::uuid
    where ba.provider_id = (verified->>'providerId')::uuid
      and ba.customer_phone = c.phone and c.provider_id = ba.provider_id
      and (po.payment_status in ('created', 'creation_unknown', 'pending')
        or (po.payment_status = 'succeeded' and po.fulfilment_status <> 'fulfilled')
        or ba.status = 'manual_review')
    order by ba.created_at desc limit 25
  ) owned;
  return result;
end $$;

revoke all on function public.get_verified_booking_payments_v1(text, text, uuid) from public, anon, authenticated;
grant execute on function public.get_verified_booking_payments_v1(text, text, uuid) to service_role;
notify pgrst, 'reload schema';
commit;
