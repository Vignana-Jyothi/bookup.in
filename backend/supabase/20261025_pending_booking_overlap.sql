begin;

-- Expiry is a persisted terminal transition, never a query-only omission.
-- Called after the caller's provider lock, before any legacy row locks/checks.
create or replace function public.expire_legacy_booking_holds_v1(
  p_provider_id uuid, p_instructor_id uuid, p_booking_date date
) returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_instructor_id::text, 41));
  update public.bookings set status = 'cancelled', payment_status = 'rejected', updated_at = clock_timestamp()
  where provider_id = p_provider_id and instructor_id = p_instructor_id
    and booking_date = p_booking_date and status in ('pending', 'pending_payment')
    and payment_status = 'awaiting_payment'
    and created_at <= clock_timestamp() - interval '30 minutes';
end;
$$;
revoke all on function public.expire_legacy_booking_holds_v1(uuid,uuid,date) from public, anon, authenticated;
grant execute on function public.expire_legacy_booking_holds_v1(uuid,uuid,date) to service_role;

-- Retain the latest resource-aware atomic function and include live manual-payment holds.
create or replace function public.create_booking_atomic(
  p_provider_id uuid, p_service_id uuid, p_customer_name text, p_customer_email text,
  p_customer_phone text, p_customer_whatsapp text, p_booking_date date, p_start_time text,
  p_notes text default '', p_management_token_hash text default null,
  p_meeting_type text default null, p_location_address text default null, p_maps_link text default null
) returns json language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_service public.services%rowtype; v_provider public.providers%rowtype;
  v_start_h integer; v_start_m integer; v_start_min integer; v_end_min integer;
  v_end_time text; v_customer_id uuid; v_booking_id uuid; v_conflict_count integer := 0;
  v_cand_end integer; v_buffer integer; v_resolved_meeting_type text;
  v_resolved_location text; v_resolved_maps_link text;
begin
  select * into v_service from public.services
  where id = p_service_id and provider_id = p_provider_id and active;
  if not found then return json_build_object('success', false, 'error', 'Invalid or inactive service'); end if;

  select * into v_provider from public.providers where id = p_provider_id for update;
  if not found then return json_build_object('success', false, 'error', 'Provider not found'); end if;

  if not public.is_generated_booking_slot_v1(p_provider_id, p_service_id, p_booking_date, p_start_time::time) then
    return json_build_object('success', false, 'error', 'This time is outside the service or instructor schedule.');
  end if;

  select greatest(coalesce(i.buffer_time, v_provider.buffer_time, 0), 0) into v_buffer
  from public.instructors i where i.id = v_service.instructor_id;
  v_resolved_meeting_type := coalesce(p_meeting_type,
    case when v_service.meeting_type = 'both' then 'online' else v_service.meeting_type end, 'online');
  if v_resolved_meeting_type = 'in-person' then
    v_resolved_location := coalesce(p_location_address, v_service.location_address, v_provider.default_location_address);
    v_resolved_maps_link := coalesce(p_maps_link, v_service.maps_link,
      case when v_resolved_location is not null then
        'https://www.google.com/maps/search/?api=1&query=' || replace(replace(v_resolved_location, ' ', '+'), ',', '%2C')
      end);
  end if;

  v_start_h := split_part(p_start_time, ':', 1)::integer;
  v_start_m := split_part(p_start_time, ':', 2)::integer;
  v_start_min := v_start_h * 60 + v_start_m;
  v_end_min := v_start_min + v_service.duration;
  v_end_time := to_char(to_timestamp(v_end_min * 60), 'HH24:MI');
  v_cand_end := v_end_min + v_buffer;

  perform public.expire_legacy_booking_holds_v1(p_provider_id, v_service.instructor_id, p_booking_date);

  perform id from public.bookings
  where provider_id = p_provider_id and instructor_id = v_service.instructor_id
    and booking_date = p_booking_date
    and status in ('pending', 'pending_payment', 'confirmed', 'completed')
    and coalesce(payment_status, '') != 'rejected'
    and v_start_min < ((split_part(coalesce(actual_end_time, end_time), ':', 1)::integer * 60)
      + split_part(coalesce(actual_end_time, end_time), ':', 2)::integer + v_buffer)
    and v_cand_end > ((split_part(start_time, ':', 1)::integer * 60) + split_part(start_time, ':', 2)::integer)
  for update;
  get diagnostics v_conflict_count = row_count;
  if v_conflict_count > 0 then
    return json_build_object('success', false, 'error', 'This slot is no longer available. Please select another time.');
  end if;

  select id into v_customer_id from public.customers where phone = p_customer_phone limit 1;
  if v_customer_id is null then
    insert into public.customers(name, email, phone, whatsapp)
    values (p_customer_name, p_customer_email, p_customer_phone, coalesce(p_customer_whatsapp, p_customer_phone))
    returning id into v_customer_id;
  else
    update public.customers set name = p_customer_name, email = coalesce(p_customer_email, email),
      whatsapp = coalesce(p_customer_whatsapp, whatsapp) where id = v_customer_id;
  end if;

  insert into public.bookings(
    provider_id, service_id, customer_id, customer_name, customer_email, customer_phone,
    customer_whatsapp, booking_date, start_time, end_time, duration, price, deposit_amount,
    deposit_status, status, payment_status, notes, management_token_hash, meeting_type,
    location_address_snapshot, maps_link_snapshot
  ) values (
    p_provider_id, v_service.id, v_customer_id, p_customer_name, p_customer_email, p_customer_phone,
    coalesce(p_customer_whatsapp, p_customer_phone), p_booking_date, p_start_time, v_end_time,
    v_service.duration, v_service.price, coalesce(v_service.deposit_amount, 0),
    case when coalesce(v_service.deposit_amount, 0) > 0 then 'pending' else 'na' end,
    case when coalesce(v_service.price, 0) > 0 then 'pending_payment' else 'confirmed' end,
    case when coalesce(v_service.price, 0) > 0 then 'awaiting_payment' else 'not_required' end, p_notes, p_management_token_hash, v_resolved_meeting_type,
    v_resolved_location, v_resolved_maps_link
  ) returning id into v_booking_id;

  return json_build_object('success', true, 'bookingId', v_booking_id, 'endTime', v_end_time,
    'price', v_service.price, 'depositAmount', coalesce(v_service.deposit_amount, 0),
    'meetingType', v_resolved_meeting_type, 'locationAddress', v_resolved_location,
    'mapsLink', v_resolved_maps_link);
end;
$$;

revoke all on function public.create_booking_atomic(uuid, uuid, text, text, text, text, date, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_booking_atomic(uuid, uuid, text, text, text, text, date, text, text, text, text, text, text) to service_role;

-- Cashfree holds must observe the same live legacy payment reservations.
create or replace function public.guard_booking_attempt_resource_v1()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
declare v_timezone text; v_buffer integer; v_start_min integer; v_end_min integer;
begin
  perform public.expire_legacy_booking_holds_v1(new.provider_id, new.instructor_id, new.booking_date);
  select coalesce(nullif(p.timezone, ''), 'Asia/Kolkata'), greatest(coalesce(i.buffer_time, p.buffer_time, 0), 0)
  into v_timezone, v_buffer from public.instructors i join public.providers p on p.id = i.provider_id
  where i.id = new.instructor_id;
  v_start_min := extract(hour from new.start_time)::integer * 60 + extract(minute from new.start_time)::integer;
  v_end_min := extract(hour from (new.ends_at at time zone v_timezone))::integer * 60
    + extract(minute from (new.ends_at at time zone v_timezone))::integer + v_buffer;
  if exists (
    select 1 from public.bookings b where b.instructor_id = new.instructor_id
      and b.booking_date = new.booking_date
      and b.status in ('pending', 'pending_payment', 'confirmed', 'completed')
      and coalesce(b.payment_status, '') <> 'rejected'
      and v_start_min < ((split_part(coalesce(b.actual_end_time, b.end_time), ':', 1)::integer * 60)
        + split_part(coalesce(b.actual_end_time, b.end_time), ':', 2)::integer + v_buffer)
      and v_end_min > ((split_part(b.start_time, ':', 1)::integer * 60) + split_part(b.start_time, ':', 2)::integer)
  ) then raise exception 'SLOT_UNAVAILABLE'; end if;
  return new;
end;
$$;


-- Keep rescheduling on the same provider/resource/row lock order.
CREATE OR REPLACE FUNCTION public.reschedule_booking_atomic(
  p_booking_id uuid,
  p_new_date date,
  p_new_time text
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_booking record;
  v_provider_id uuid;
  v_instructor_id uuid;
  v_booking_date date;
  v_provider record;
  v_start_h integer;
  v_start_m integer;
  v_start_min integer;
  v_end_min integer;
  v_new_end_time text;
  v_buffer integer;
  v_cand_start integer;
  v_cand_end integer;
  v_conflict_count integer := 0;
BEGIN
  -- Match creation/checkout lock order: provider, instructor, then booking.
  SELECT provider_id, instructor_id, booking_date
  INTO v_provider_id, v_instructor_id, v_booking_date
  FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Booking not found');
  END IF;
  SELECT * INTO v_provider FROM public.providers WHERE id = v_provider_id FOR UPDATE;
  PERFORM public.expire_legacy_booking_holds_v1(v_provider_id, v_instructor_id, v_booking_date);
  PERFORM public.expire_legacy_booking_holds_v1(v_provider_id, v_instructor_id, p_new_date);
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Booking not found');
  END IF;
  IF v_booking.provider_id IS DISTINCT FROM v_provider_id
    OR v_booking.instructor_id IS DISTINCT FROM v_instructor_id THEN
    RETURN json_build_object('success', false, 'error', 'Booking resource changed. Retry the request.');
  END IF;

  IF v_booking.status IN ('cancelled', 'late-cancellation') THEN
    RETURN json_build_object('success', false, 'error', 'Cancelled appointments cannot be rescheduled.');
  END IF;
  IF v_booking.status = 'completed' THEN
    RETURN json_build_object('success', false, 'error', 'Completed appointments cannot be rescheduled.');
  END IF;
  IF v_booking.status = 'rejected' OR COALESCE(v_booking.payment_status, '') = 'rejected' THEN
    RETURN json_build_object('success', false, 'error', 'Rejected appointments cannot be rescheduled.');
  END IF;

  -- 2. Fetch provider for buffer time and serialize concurrent reschedule attempts
  v_buffer := COALESCE(v_provider.buffer_time, 15);

  -- 3. Compute new end time
  v_start_h := split_part(p_new_time, ':', 1)::integer;
  v_start_m := split_part(p_new_time, ':', 2)::integer;
  v_start_min := (v_start_h * 60) + v_start_m;
  v_end_min := v_start_min + COALESCE(v_booking.duration, 60);
  v_new_end_time := to_char(to_timestamp(v_end_min * 60), 'HH24:MI');

  v_cand_start := v_start_min;
  v_cand_end := v_end_min + v_buffer;

  -- 4. Lock conflicting rows + conflict check (excluding this booking)
  -- Separated from aggregate function (no COUNT inside FOR UPDATE) to avoid Postgres error 0A000.
  PERFORM id
  FROM public.bookings
  WHERE provider_id = v_booking.provider_id
    AND booking_date = p_new_date
    AND id != p_booking_id
    AND status IN ('pending', 'pending_payment', 'confirmed', 'completed')
    AND COALESCE(payment_status, '') != 'rejected'
    AND (
      v_cand_start < (
        (split_part(COALESCE(actual_end_time, end_time), ':', 1)::integer * 60) +
        split_part(COALESCE(actual_end_time, end_time), ':', 2)::integer +
        v_buffer
      )
      AND v_cand_end > (
        (split_part(start_time, ':', 1)::integer * 60) +
        split_part(start_time, ':', 2)::integer
      )
    )
  FOR UPDATE;

  GET DIAGNOSTICS v_conflict_count = ROW_COUNT;

  IF v_conflict_count > 0 THEN
    RETURN json_build_object('success', false, 'error', 'Selected time slot is no longer available. Please select another slot.');
  END IF;

  -- 5. Update booking
  UPDATE public.bookings
  SET booking_date = p_new_date,
      start_time = p_new_time,
      end_time = v_new_end_time,
      updated_at = now(),
      reminder_sent_at = NULL,
      reminder_msg_id = NULL,
      reminder_error = NULL
  WHERE id = p_booking_id;

  RETURN json_build_object(
    'success', true,
    'bookingId', p_booking_id,
    'newDate', p_new_date,
    'newTime', p_new_time,
    'newEndTime', v_new_end_time,
    'duration', COALESCE(v_booking.duration, 60)
  );
END;
$$;

revoke all on function public.reschedule_booking_atomic(uuid,date,text) from public, anon, authenticated;
grant execute on function public.reschedule_booking_atomic(uuid,date,text) to service_role;

commit;
