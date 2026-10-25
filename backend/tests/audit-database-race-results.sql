begin;
select set_config('calup.audit.provider_a',:'provider_a',true);
do $$
declare live_count integer; expired_state record;
begin
  select count(*) into live_count from public.bookings
  where provider_id=current_setting('calup.audit.provider_a')::uuid
    and booking_date=:'booking_date'::date and start_time in ('11:00','13:00','15:00')
    and status in ('pending','pending_payment','confirmed','completed') and payment_status<>'rejected';
  if live_count<>2 then raise exception 'Competing allocation/reschedule operations did not preserve two live bookings'; end if;
  select count(*) into live_count from public.bookings
  where provider_id=current_setting('calup.audit.provider_a')::uuid
    and booking_date=:'booking_date'::date and start_time='15:00'
    and status in ('pending','pending_payment','confirmed','completed') and payment_status<>'rejected';
  if live_count<>1 then raise exception 'Competing reschedules did not leave exactly one destination booking'; end if;
  select status,payment_status into expired_state from public.bookings
  where provider_id=current_setting('calup.audit.provider_a')::uuid
    and customer_name='audit-expired-' || current_setting('calup.audit.provider_a');
  if not found or not ((expired_state.status='cancelled' and expired_state.payment_status='rejected')
    or (expired_state.status='pending_payment' and expired_state.payment_status='verification_pending')) then
    raise exception 'Old reservation was revived or lost after expiry race';
  end if;
end $$;
rollback;
