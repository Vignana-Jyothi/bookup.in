-- Human-readable public booking IDs for confirmed Cashfree appointments.

create or replace function app.generate_booking_reference_v1()
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog, app
as $$
declare
  v_bytes bytea;
  v_number bigint;
  v_reference text;
begin
  -- Serialize the tiny generation window so the existence check and returned
  -- value cannot race another appointment insert.
  perform pg_advisory_xact_lock(hashtextextended('app.booking_reference_v1', 0));

  loop
    v_bytes := extensions.gen_random_bytes(4);
    v_number := 100000000 + mod(
      get_byte(v_bytes, 0)::bigint * 16777216 +
      get_byte(v_bytes, 1)::bigint * 65536 +
      get_byte(v_bytes, 2)::bigint * 256 +
      get_byte(v_bytes, 3)::bigint,
      900000000
    );
    v_reference := 'M' || v_number::text;
    exit when not exists (
      select 1 from app.appointments where booking_reference = v_reference
    );
  end loop;

  return v_reference;
end;
$$;

alter table app.appointments
  add column if not exists booking_reference text;

do $$
declare
  v_id uuid;
begin
  for v_id in
    select id from app.appointments where booking_reference is null order by created_at, id
  loop
    update app.appointments
    set booking_reference = app.generate_booking_reference_v1()
    where id = v_id;
  end loop;
end;
$$;

alter table app.appointments
  alter column booking_reference set default app.generate_booking_reference_v1(),
  alter column booking_reference set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'appointments_booking_reference_format_v1'
  ) then
    alter table app.appointments
      add constraint appointments_booking_reference_format_v1
      check (booking_reference ~ '^M[0-9]{9}$');
  end if;
end;
$$;

create unique index if not exists appointments_booking_reference_unique_v1
  on app.appointments(booking_reference);

revoke all on function app.generate_booking_reference_v1() from public, anon, authenticated;
grant execute on function app.generate_booking_reference_v1() to service_role;

comment on column app.appointments.booking_reference is
  'Immutable public booking ID in M plus nine digits format. The UUID primary key remains internal authority.';

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
    'bookingId', v_appointment.booking_reference,
    'resolutionCaseId', v_case_id,
    'providerSlug', v_provider.slug,
    'receipt', case
      when v_order.payment_status = 'succeeded'
        and v_order.fulfilment_status = 'fulfilled'
        and v_appointment.id is not null
      then jsonb_build_object(
        'bookingId', v_appointment.booking_reference,
        'appointmentId', v_appointment.id,
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

create or replace function public.get_merchant_cashfree_appointments_v1(
  p_provider_id uuid
) returns jsonb
language sql stable security definer
set search_path = pg_catalog, public, app, finance
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'bookingId', a.booking_reference,
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
