-- Safe merchant-dashboard projection for confirmed Cashfree appointments.

create or replace function public.get_merchant_cashfree_appointments_v1(
  p_provider_id uuid
) returns jsonb
language sql stable security definer
set search_path = pg_catalog, public, app, finance
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'providerId', a.provider_id,
    'serviceId', a.service_id,
    'serviceName', coalesce(s.name, 'Service'),
    'customerName', a.customer_name,
    'customerPhone', a.customer_phone,
    'customerWhatsApp', a.customer_phone,
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
      else a.status
    end,
    'paymentStatus', 'confirmed',
    'paymentConfirmedAt', po.paid_at,
    'meetingType', a.meeting_type,
    'createdAt', a.created_at,
    'sourceSystem', 'cashfree_v1'
  ) order by a.starts_at desc), '[]'::jsonb)
  from app.appointments a
  join public.providers p on p.id = a.provider_id
  left join public.services s on s.id = a.service_id
  join finance.payment_orders po on po.id = a.payment_order_id
  where a.provider_id = p_provider_id
    and po.payment_status = 'succeeded'
    and po.fulfilment_status = 'fulfilled';
$$;

revoke all on function public.get_merchant_cashfree_appointments_v1(uuid) from public, anon, authenticated;
grant execute on function public.get_merchant_cashfree_appointments_v1(uuid) to service_role;

comment on function public.get_merchant_cashfree_appointments_v1 is
  'Service-role-only merchant dashboard projection of fulfilled Cashfree appointments in the merchant timezone.';
