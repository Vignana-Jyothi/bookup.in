-- ==============================================================================
-- CalUp — Phase 1: Online/Offline Appointment Support & Atomic Booking Migration
-- Adds meeting type + location fields to services, providers, and bookings.
-- Replaces the non-atomic booking creation path with a transactional RPC.
--
-- This migration is additive only. It does NOT modify existing columns,
-- booking status values, or the cancellation_policies table.
-- ==============================================================================

-- =============================================================================
-- 1. SERVICES TABLE: Add meeting type and location fields
-- =============================================================================

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS meeting_type text DEFAULT 'online',
  ADD COLUMN IF NOT EXISTS location_address text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS maps_link text DEFAULT NULL;

COMMENT ON COLUMN public.services.meeting_type IS
  'Session mode: ''online'' (Google Meet), ''in-person'' (at location), or ''both'' (customer chooses). Default: online.';

COMMENT ON COLUMN public.services.location_address IS
  'Physical address for in-person sessions. May be overridden from providers.default_location_address.';

COMMENT ON COLUMN public.services.maps_link IS
  'Google Maps directions link for in-person sessions. Auto-generated from location_address if not explicitly set.';

-- Validate meeting_type values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'services_meeting_type_check'
  ) THEN
    ALTER TABLE public.services
      ADD CONSTRAINT services_meeting_type_check
      CHECK (meeting_type IN ('online', 'in-person', 'both'));
  END IF;
END $$;

-- =============================================================================
-- 2. PROVIDERS TABLE: Add default location address
-- =============================================================================

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS default_location_address text DEFAULT NULL;

COMMENT ON COLUMN public.providers.default_location_address IS
  'Default business address reused across in-person services. Set from Settings page.';

-- =============================================================================
-- 3. BOOKINGS TABLE: Add meeting type and location snapshots
-- =============================================================================

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS meeting_type text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS location_address_snapshot text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS maps_link_snapshot text DEFAULT NULL;

COMMENT ON COLUMN public.bookings.meeting_type IS
  'Resolved meeting type at booking time: ''online'' or ''in-person''. Denormalized from service so address changes don''t alter past bookings.';

COMMENT ON COLUMN public.bookings.location_address_snapshot IS
  'Physical address snapshot at booking time for in-person appointments.';

COMMENT ON COLUMN public.bookings.maps_link_snapshot IS
  'Google Maps link snapshot at booking time for in-person appointments.';

-- =============================================================================
-- 4. UPDATED ATOMIC BOOKING FUNCTION (eliminates TOCTOU race)
-- Now accepts meeting_type + location fields and runs conflict check + insert
-- inside a single transaction with row-level locking.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_booking_atomic(
  p_provider_id uuid,
  p_service_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_customer_whatsapp text,
  p_booking_date date,
  p_start_time text,
  p_notes text DEFAULT '',
  p_management_token_hash text DEFAULT NULL,
  p_meeting_type text DEFAULT NULL,
  p_location_address text DEFAULT NULL,
  p_maps_link text DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_service record;
  v_provider record;
  v_start_h integer;
  v_start_m integer;
  v_start_min integer;
  v_end_min integer;
  v_end_time text;
  v_customer_id uuid;
  v_booking_id uuid;
  v_conflict_count integer;
  v_cand_start integer;
  v_cand_end integer;
  v_buffer integer;
  v_resolved_meeting_type text;
  v_resolved_location text;
  v_resolved_maps_link text;
BEGIN
  -- 1. Fetch Authoritative Service Details (never trust client-supplied price or duration)
  SELECT * INTO v_service FROM public.services
  WHERE id = p_service_id AND provider_id = p_provider_id AND active = true;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Invalid or inactive service');
  END IF;

  -- 2. Fetch Authoritative Provider Details (buffer time + default location)
  SELECT * INTO v_provider FROM public.providers WHERE id = p_provider_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Provider not found');
  END IF;

  v_buffer := COALESCE(v_provider.buffer_time, 15);

  -- 3. Resolve meeting type and location
  v_resolved_meeting_type := COALESCE(p_meeting_type, 
    CASE WHEN v_service.meeting_type = 'both' THEN 'online' ELSE v_service.meeting_type END,
    'online'
  );
  
  IF v_resolved_meeting_type = 'in-person' THEN
    v_resolved_location := COALESCE(p_location_address, v_service.location_address, v_provider.default_location_address);
    v_resolved_maps_link := COALESCE(p_maps_link, v_service.maps_link,
      CASE WHEN v_resolved_location IS NOT NULL 
        THEN 'https://www.google.com/maps/search/?api=1&query=' || replace(replace(v_resolved_location, ' ', '+'), ',', '%2C')
        ELSE NULL
      END
    );
  ELSE
    v_resolved_location := NULL;
    v_resolved_maps_link := NULL;
  END IF;

  -- 4. Parse Start Time and Calculate Authoritative End Time
  v_start_h := split_part(p_start_time, ':', 1)::integer;
  v_start_m := split_part(p_start_time, ':', 2)::integer;
  v_start_min := (v_start_h * 60) + v_start_m;
  v_end_min := v_start_min + v_service.duration;
  v_end_time := to_char(to_timestamp(v_end_min * 60), 'HH24:MI');

  v_cand_start := v_start_min;
  v_cand_end := v_end_min + v_buffer;

  -- 5. Authoritative Conflict Check with row-level lock:
  -- Lock all confirmed/completed bookings for this provider+date to prevent TOCTOU races.
  -- This SELECT ... FOR UPDATE ensures concurrent transactions serialize on the same rows.
  SELECT count(*) INTO v_conflict_count
  FROM public.bookings
  WHERE provider_id = p_provider_id
    AND booking_date = p_booking_date
    AND status IN ('confirmed', 'completed')
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

  IF v_conflict_count > 0 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'This slot is no longer available. Please select another time.'
    );
  END IF;

  -- 6. Upsert Customer Record by Phone
  SELECT id INTO v_customer_id FROM public.customers WHERE phone = p_customer_phone LIMIT 1;
  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (name, email, phone, whatsapp)
    VALUES (p_customer_name, p_customer_email, p_customer_phone, COALESCE(p_customer_whatsapp, p_customer_phone))
    RETURNING id INTO v_customer_id;
  ELSE
    UPDATE public.customers
    SET name = p_customer_name,
        email = COALESCE(p_customer_email, email),
        whatsapp = COALESCE(p_customer_whatsapp, whatsapp)
    WHERE id = v_customer_id;
  END IF;

  -- 7. Insert Confirmed Booking with meeting_type + location snapshots
  INSERT INTO public.bookings (
    provider_id,
    service_id,
    customer_id,
    customer_name,
    customer_email,
    customer_phone,
    customer_whatsapp,
    booking_date,
    start_time,
    end_time,
    duration,
    price,
    deposit_amount,
    deposit_status,
    status,
    notes,
    management_token_hash,
    meeting_type,
    location_address_snapshot,
    maps_link_snapshot
  ) VALUES (
    p_provider_id,
    v_service.id,
    v_customer_id,
    p_customer_name,
    p_customer_email,
    p_customer_phone,
    COALESCE(p_customer_whatsapp, p_customer_phone),
    p_booking_date,
    p_start_time,
    v_end_time,
    v_service.duration,
    v_service.price,
    COALESCE(v_service.deposit_amount, 0),
    CASE WHEN COALESCE(v_service.deposit_amount, 0) > 0 THEN 'paid' ELSE 'na' END,
    'confirmed',
    p_notes,
    p_management_token_hash,
    v_resolved_meeting_type,
    v_resolved_location,
    v_resolved_maps_link
  ) RETURNING id INTO v_booking_id;

  RETURN json_build_object(
    'success', true,
    'bookingId', v_booking_id,
    'endTime', v_end_time,
    'price', v_service.price,
    'depositAmount', COALESCE(v_service.deposit_amount, 0),
    'meetingType', v_resolved_meeting_type,
    'locationAddress', v_resolved_location,
    'mapsLink', v_resolved_maps_link
  );
END;
$$;

-- =============================================================================
-- 5. ATOMIC RESCHEDULE FUNCTION (eliminates TOCTOU race for reschedule)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.reschedule_booking_atomic(
  p_booking_id uuid,
  p_new_date date,
  p_new_time text
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_booking record;
  v_provider record;
  v_start_h integer;
  v_start_m integer;
  v_start_min integer;
  v_end_min integer;
  v_new_end_time text;
  v_buffer integer;
  v_cand_start integer;
  v_cand_end integer;
  v_conflict_count integer;
BEGIN
  -- 1. Fetch the booking
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Booking not found');
  END IF;

  IF v_booking.status IN ('cancelled', 'late-cancellation') THEN
    RETURN json_build_object('success', false, 'error', 'Cancelled appointments cannot be rescheduled.');
  END IF;
  IF v_booking.status = 'completed' THEN
    RETURN json_build_object('success', false, 'error', 'Completed appointments cannot be rescheduled.');
  END IF;

  -- 2. Fetch provider for buffer time
  SELECT * INTO v_provider FROM public.providers WHERE id = v_booking.provider_id;
  v_buffer := COALESCE(v_provider.buffer_time, 15);

  -- 3. Compute new end time
  v_start_h := split_part(p_new_time, ':', 1)::integer;
  v_start_m := split_part(p_new_time, ':', 2)::integer;
  v_start_min := (v_start_h * 60) + v_start_m;
  v_end_min := v_start_min + COALESCE(v_booking.duration, 60);
  v_new_end_time := to_char(to_timestamp(v_end_min * 60), 'HH24:MI');

  v_cand_start := v_start_min;
  v_cand_end := v_end_min + v_buffer;

  -- 4. Lock + conflict check (excluding this booking)
  SELECT count(*) INTO v_conflict_count
  FROM public.bookings
  WHERE provider_id = v_booking.provider_id
    AND booking_date = p_new_date
    AND id != p_booking_id
    AND status IN ('confirmed', 'completed')
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

-- Grant execute to all roles
GRANT EXECUTE ON FUNCTION public.create_booking_atomic(uuid, uuid, text, text, text, text, date, text, text, text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reschedule_booking_atomic(uuid, date, text) TO anon, authenticated, service_role;
