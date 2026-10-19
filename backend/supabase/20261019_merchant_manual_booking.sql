begin;

create table if not exists app.merchant_booking_requests (
  provider_id uuid not null references public.providers(id),
  request_key uuid not null,
  request_hash text not null check (length(request_hash)=64),
  booking_id uuid references public.bookings(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (provider_id, request_key)
);
alter table app.merchant_booking_requests enable row level security;
revoke all on app.merchant_booking_requests from public, anon, authenticated;
grant all on app.merchant_booking_requests to service_role;

-- Called only by the authenticated server route with its verified provider ID.
-- Existing create_booking_atomic and scheduling triggers validate generated
-- instructor slots and conflicts against both legacy and Cashfree allocations.
create or replace function public.create_merchant_booking_v1(p_provider_id uuid, p_key uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare prior app.merchant_booking_requests%rowtype; result json; saved public.bookings%rowtype; fingerprint text;
begin
  if p_provider_id is null or p_key is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
  fingerprint := encode(extensions.digest(p_payload::text, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_provider_id::text, 1));
  select * into prior from app.merchant_booking_requests where provider_id=p_provider_id and request_key=p_key;
  if found then
    if prior.request_hash <> fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    if prior.booking_id is null then raise exception 'REQUEST_ENDED'; end if;
    select * into saved from public.bookings where id=prior.booking_id and provider_id=p_provider_id;
    if not found then raise exception 'REQUEST_ENDED'; end if;
    return to_jsonb(saved) || jsonb_build_object('service_name',(select name from public.services where id=saved.service_id));
  end if;
  result := public.create_booking_atomic(
    p_provider_id, (p_payload->>'serviceId')::uuid, p_payload->>'customerName',
    p_payload->>'customerEmail', p_payload->>'customerPhone', p_payload->>'customerWhatsApp',
    (p_payload->>'bookingDate')::date, p_payload->>'startTime', p_payload->>'notes',
    null::text, null::text, null::text, null::text
  );
  if (result->>'success')::boolean is distinct from true then
    raise exception 'SLOT_UNAVAILABLE' using detail=coalesce(result->>'error', 'Appointment could not be saved');
  end if;
  -- Recording a merchant appointment is not evidence of collecting money.
  update public.bookings set
    payment_status=case when price > 0 then 'awaiting_payment' else 'not_required' end,
    deposit_status=case when deposit_amount > 0 then 'unpaid' else 'na' end
  where id=(coalesce(result->>'bookingId',result->>'booking_id'))::uuid and provider_id=p_provider_id
  returning * into saved;
  if not found then raise exception 'BOOKING_NOT_SAVED'; end if;
  insert into app.merchant_booking_requests(provider_id,request_key,request_hash,booking_id)
  values(p_provider_id,p_key,fingerprint,saved.id);
  return to_jsonb(saved) || jsonb_build_object('service_name',(select name from public.services where id=saved.service_id));
end $$;
revoke all on function public.create_merchant_booking_v1(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.create_merchant_booking_v1(uuid,uuid,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
