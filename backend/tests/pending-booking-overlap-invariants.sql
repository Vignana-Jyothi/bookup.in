-- Run in an isolated database after migrations; inspect actual installed bodies.
do $$
declare create_body text; guard_body text; expiry_body text; reschedule_body text;
begin
  create_body := pg_get_functiondef('public.create_booking_atomic(uuid,uuid,text,text,text,text,date,text,text,text,text,text,text)'::regprocedure);
  guard_body := pg_get_functiondef('public.guard_booking_attempt_resource_v1()'::regprocedure);
  if position('status in (''pending'', ''pending_payment'', ''confirmed'', ''completed'')' in create_body) = 0
    or position('''awaiting_payment''' in create_body) = 0
    or position('''not_required''' in create_body) = 0
    or position('expire_legacy_booking_holds_v1' in create_body) = 0
    or position('then ''pending'' else ''na''' in create_body) = 0 then
    raise exception 'Legacy creation must atomically persist unpaid state and respect live pending reservations';
  end if;
  if position('b.status in (''pending'', ''pending_payment'', ''confirmed'', ''completed'')' in guard_body) = 0
    or position('expire_legacy_booking_holds_v1' in guard_body) = 0 then
    raise exception 'Cashfree hold guard must respect pending manual-payment reservations';
  end if;
  expiry_body := pg_get_functiondef('public.expire_legacy_booking_holds_v1(uuid,uuid,date)'::regprocedure);
  reschedule_body := pg_get_functiondef('public.reschedule_booking_atomic(uuid,date,text)'::regprocedure);
  if position('pg_advisory_xact_lock' in expiry_body) = 0
    or position('status = ''cancelled'', payment_status = ''rejected''' in expiry_body) = 0
    or position('created_at <= clock_timestamp() - interval ''30 minutes''' in expiry_body) = 0 then
    raise exception 'Expiry must persist terminal unpaid state under the instructor lock';
  end if;
  if position('FROM public.providers WHERE id = v_provider_id FOR UPDATE' in reschedule_body) = 0
    or position('FROM public.providers WHERE id = v_provider_id FOR UPDATE' in reschedule_body) > position('PERFORM public.expire_legacy_booking_holds_v1' in reschedule_body)
    or position('PERFORM public.expire_legacy_booking_holds_v1' in reschedule_body) > position('FROM public.bookings WHERE id = p_booking_id FOR UPDATE' in reschedule_body) then
    raise exception 'Reschedule lock order must be provider, instructor, booking';
  end if;
end $$;
