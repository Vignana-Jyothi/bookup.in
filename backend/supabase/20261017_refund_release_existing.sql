begin;
-- Compatibility repair for deployments of the initial release function.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.release_refunded_appointment_v1()'::regprocedure);
  execute replace(definition,'meet_link=null,updated_at=clock_timestamp(),','meet_link=null,');
end $$;
-- Apply the new lifecycle to refunds already initiated before the release trigger existed.
update public.booking_refund_requests set status=status
  where refund_id is not null and status in ('approved','processing','refunded');
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.approve_booking_refund_v1(uuid,uuid,uuid,integer,text,text)'::regprocedure);
  execute replace(definition,'It is not refunded until Cashfree confirms success. Appointment changes are handled separately.',
    'The appointment is cancelled and its slot is released. It is not refunded until Cashfree confirms success.');
end $$;
commit;
