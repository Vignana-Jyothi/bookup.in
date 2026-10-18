begin;
-- Verification may restore historical records for frozen merchants; new purchases remain gated.
create or replace function public.begin_commerce_otp_v1(p_slug text,p_phone text,p_booking_reference text,p_ip_hash text)
returns uuid language plpgsql security definer set search_path='' as $$
declare provider uuid; booking uuid; challenge uuid;
begin
  if p_phone !~ '^[6-9][0-9]{9}$' or p_ip_hash !~ '^[a-f0-9]{64}$' then raise exception 'VALIDATION_FAILED'; end if;
  select id into provider from public.providers where slug=p_slug;
  if not found then raise exception 'ACCESS_UNAVAILABLE'; end if;
  if p_booking_reference is not null then
    select a.id into booking from app.appointments a join finance.payment_orders o on o.id=a.payment_order_id
      where a.provider_id=provider and a.booking_reference=p_booking_reference
        and right(regexp_replace(a.customer_phone,'[^0-9]','','g'),10)=p_phone
        and a.ends_at<=now() and a.status in ('confirmed','completed','outcome_pending')
        and o.payment_status='succeeded' and o.fulfilment_status='fulfilled';
    if not found then raise exception 'BOOKING_NOT_ELIGIBLE'; end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('commerce-otp-phone:'||p_phone,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('commerce-otp-ip:'||p_ip_hash,0));
  if exists(select 1 from public.commerce_otp_challenges where phone=p_phone and created_at>now()-interval '60 seconds')
    or (select count(*) from public.commerce_otp_challenges where phone=p_phone and created_at>now()-interval '1 hour')>=5
    or (select count(*) from public.commerce_otp_challenges where ip_hash=p_ip_hash and created_at>now()-interval '1 hour')>=20 then raise exception 'OTP_RATE_LIMIT'; end if;
  insert into public.commerce_otp_challenges(provider_id,phone,booking_id,ip_hash) values(provider,p_phone,booking,p_ip_hash) returning id into challenge;
  return challenge;
end $$;
commit;
