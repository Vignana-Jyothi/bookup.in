-- Read-only customer tracking projection for fulfilled Cashfree appointments.
-- A public booking reference is an identifier, so the exact booking phone is
-- required as a second factor before any appointment data is returned.

create or replace function public.get_customer_booking_by_reference_v1(
  p_booking_reference text,
  p_customer_phone text
) returns jsonb
language sql stable security definer
set search_path = pg_catalog, public, app, finance
as $$
  select jsonb_build_object(
    'booking', jsonb_build_object(
      'id', a.id,
      'bookingId', a.booking_reference,
      'serviceId', a.service_id,
      'serviceName', coalesce(s.name, 'Service'),
      'customerName', a.customer_name,
      'customerPhone', a.customer_phone,
      'customerEmail', coalesce(a.customer_email, ''),
      'date', to_char(a.starts_at at time zone coalesce(p.timezone, 'Asia/Kolkata'), 'YYYY-MM-DD'),
      'startTime', to_char(a.starts_at at time zone coalesce(p.timezone, 'Asia/Kolkata'), 'HH24:MI'),
      'endTime', to_char(a.ends_at at time zone coalesce(p.timezone, 'Asia/Kolkata'), 'HH24:MI'),
      'duration', greatest(1, floor(extract(epoch from (a.ends_at - a.starts_at)) / 60)::integer),
      'price', po.amount_paise::numeric / 100,
      'depositAmount', 0,
      'depositStatus', 'na',
      'status', case a.status
        when 'customer_no_show' then 'no-show'
        when 'merchant_no_show' then 'no-show'
        when 'attendance_disputed' then 'disputed'
        else a.status
      end,
      'paymentStatus', case when po.payment_status = 'succeeded' then 'confirmed' else po.payment_status end,
      'paymentConfirmedAt', po.paid_at,
      'meetingType', a.meeting_type,
      'createdAt', a.created_at,
      'sourceSystem', 'cashfree_v1',
      'readOnly', true
    ),
    'provider', jsonb_build_object(
      'id', p.id,
      'name', coalesce(p.name, 'Provider'),
      'businessName', coalesce(p.business_name, ''),
      'slug', p.slug,
      'timezone', coalesce(p.timezone, 'Asia/Kolkata')
    ),
    'service', jsonb_build_object(
      'id', s.id,
      'name', coalesce(s.name, 'Service'),
      'duration', s.duration
    )
  )
  from app.appointments a
  join public.providers p on p.id = a.provider_id
  join public.services s on s.id = a.service_id
  join finance.payment_orders po on po.id = a.payment_order_id
  where a.booking_reference = upper(trim(p_booking_reference))
    and a.customer_phone = p_customer_phone
    and po.payment_status = 'succeeded'
    and po.fulfilment_status = 'fulfilled'
  limit 1;
$$;

revoke all on function public.get_customer_booking_by_reference_v1(text, text) from public, anon, authenticated;
grant execute on function public.get_customer_booking_by_reference_v1(text, text) to service_role;

comment on function public.get_customer_booking_by_reference_v1 is
  'Service-role-only read projection. Requires exact normalized phone and returns no result for either an unknown reference or a phone mismatch.';
