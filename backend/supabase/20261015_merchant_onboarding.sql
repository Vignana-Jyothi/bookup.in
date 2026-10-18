-- Durable, server-owned merchant onboarding and atomic setup completion.

create table if not exists app.merchant_onboarding (
  provider_id uuid primary key references public.providers(id) on delete cascade,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  current_step integer not null default 0 check (current_step between 0 and 6),
  draft jsonb not null default '{}'::jsonb,
  service_id uuid references public.services(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into app.merchant_onboarding(provider_id, status, current_step, completed_at)
select p.id,
  case when exists (select 1 from public.services s where s.provider_id = p.id) then 'completed' else 'in_progress' end,
  case when exists (select 1 from public.services s where s.provider_id = p.id) then 6 else 0 end,
  case when exists (select 1 from public.services s where s.provider_id = p.id) then p.updated_at else null end
from public.providers p
on conflict (provider_id) do nothing;

create or replace function app.create_merchant_onboarding_v1()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
begin
  insert into app.merchant_onboarding(provider_id) values (new.id)
  on conflict (provider_id) do nothing;
  return new;
end;
$$;

drop trigger if exists providers_create_onboarding_v1 on public.providers;
create trigger providers_create_onboarding_v1
after insert on public.providers
for each row execute function app.create_merchant_onboarding_v1();

create or replace function public.get_merchant_onboarding_v1(p_provider_id uuid)
returns jsonb language sql stable security definer
set search_path = pg_catalog, public, app
as $$
  select jsonb_build_object(
    'status', status,
    'currentStep', current_step,
    'draft', draft,
    'serviceId', service_id,
    'completedAt', completed_at
  )
  from app.merchant_onboarding
  where provider_id = p_provider_id;
$$;

create or replace function public.save_merchant_onboarding_draft_v1(
  p_provider_id uuid,
  p_current_step integer,
  p_draft jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
begin
  insert into app.merchant_onboarding(provider_id, status, current_step, draft, updated_at)
  values (p_provider_id, 'in_progress', greatest(0, least(6, p_current_step)), p_draft, now())
  on conflict (provider_id) do update set
    status = case when app.merchant_onboarding.status = 'completed' then 'completed' else 'in_progress' end,
    current_step = greatest(app.merchant_onboarding.current_step, excluded.current_step),
    draft = excluded.draft,
    updated_at = now();
  return jsonb_build_object('saved', true, 'currentStep', greatest(0, least(6, p_current_step)));
end;
$$;

create or replace function public.complete_merchant_onboarding_v1(
  p_provider_id uuid,
  p_draft jsonb,
  p_publish_ready boolean
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_owner_id uuid;
  v_service_id uuid;
  v_days text[];
  v_day text;
  v_day_value jsonb;
  v_start time;
  v_end time;
  v_active boolean;
begin
  if not exists (select 1 from public.providers where id = p_provider_id) then
    raise exception 'PROVIDER_NOT_FOUND';
  end if;

  select id into v_owner_id from public.instructors
  where provider_id = p_provider_id and is_owner and active;
  if v_owner_id is null then raise exception 'DEFAULT_INSTRUCTOR_NOT_FOUND'; end if;

  update public.providers set
    name = btrim(p_draft->>'providerName'),
    business_name = btrim(p_draft->>'businessName'),
    email = lower(btrim(p_draft->>'merchantEmail')),
    phone = p_draft->>'phone',
    bio = btrim(p_draft->>'bio'),
    timezone = coalesce(nullif(p_draft->>'timezone', ''), 'Asia/Kolkata'),
    buffer_time = (p_draft->'bookingRules'->>'bufferTime')::integer,
    min_notice = (p_draft->'bookingRules'->>'minNotice')::integer,
    max_advance_booking = (p_draft->'bookingRules'->>'maxAdvanceBooking')::integer,
    updated_at = now()
  where id = p_provider_id;

  foreach v_day in array array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] loop
    v_day_value := p_draft->'availability'->v_day;
    v_active := coalesce((v_day_value->>'available')::boolean, false);
    v_start := coalesce(nullif(v_day_value->>'start', '')::time, '09:00'::time);
    v_end := coalesce(nullif(v_day_value->>'end', '')::time, '18:00'::time);
    if v_end <= v_start then raise exception 'INVALID_AVAILABILITY'; end if;

    insert into public.availability(provider_id, day_of_week, start_time, end_time, active)
    values (p_provider_id, v_day, to_char(v_start, 'HH24:MI'), to_char(v_end, 'HH24:MI'), v_active)
    on conflict (provider_id, day_of_week) do update set
      start_time = excluded.start_time, end_time = excluded.end_time, active = excluded.active;

    insert into public.instructor_availability(instructor_id, day_of_week, start_time, end_time, active, updated_at)
    values (v_owner_id, v_day, v_start, v_end, v_active, now())
    on conflict (instructor_id, day_of_week) do update set
      start_time = excluded.start_time, end_time = excluded.end_time,
      active = excluded.active, updated_at = now();
  end loop;

  select coalesce(array_agg(day order by position), '{}'::text[]) into v_days
  from (
    select day, position from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) with ordinality d(day, position)
    where coalesce((p_draft->'availability'->day->>'available')::boolean, false)
  ) active_days;
  if cardinality(v_days) = 0 then raise exception 'AVAILABILITY_REQUIRED'; end if;

  select service_id into v_service_id from app.merchant_onboarding where provider_id = p_provider_id for update;
  if v_service_id is null then
    insert into public.services(
      provider_id, name, description, duration, price, deposit_amount, active,
      meeting_type, location_address, instructor_id, available_weekdays
    ) values (
      p_provider_id, btrim(p_draft->'service'->>'name'), btrim(p_draft->'service'->>'description'),
      (p_draft->'service'->>'duration')::integer, (p_draft->'service'->>'price')::numeric, 0,
      p_publish_ready, p_draft->'service'->>'meetingType',
      nullif(btrim(p_draft->'service'->>'locationAddress'), ''), v_owner_id, v_days
    ) returning id into v_service_id;
  else
    update public.services set
      name = btrim(p_draft->'service'->>'name'),
      description = btrim(p_draft->'service'->>'description'),
      duration = (p_draft->'service'->>'duration')::integer,
      price = (p_draft->'service'->>'price')::numeric,
      deposit_amount = 0,
      active = p_publish_ready,
      meeting_type = p_draft->'service'->>'meetingType',
      location_address = nullif(btrim(p_draft->'service'->>'locationAddress'), ''),
      instructor_id = v_owner_id,
      available_weekdays = v_days,
      updated_at = now()
    where id = v_service_id and provider_id = p_provider_id;
  end if;

  update public.cancellation_policies set
    cancellation_window = (p_draft->'bookingRules'->>'cancellationWindow')::integer,
    full_refund_hours = (p_draft->'bookingRules'->>'cancellationWindow')::integer,
    fee = 0,
    policy_text = 'Full refund when cancelled before the merchant cancellation window. No customer-side platform fee is deducted.',
    updated_at = now()
  where provider_id = p_provider_id;
  if not found then
    insert into public.cancellation_policies(
      provider_id, cancellation_window, full_refund_hours, fee, policy_text
    ) values (
      p_provider_id,
      (p_draft->'bookingRules'->>'cancellationWindow')::integer,
      (p_draft->'bookingRules'->>'cancellationWindow')::integer,
      0,
      'Full refund when cancelled before the merchant cancellation window. No customer-side platform fee is deducted.'
    );
  end if;

  insert into app.merchant_onboarding(provider_id, status, current_step, draft, service_id, completed_at, updated_at)
  values (p_provider_id, 'completed', 6, p_draft, v_service_id, now(), now())
  on conflict (provider_id) do update set
    status = 'completed', current_step = 6, draft = excluded.draft,
    service_id = excluded.service_id, completed_at = coalesce(app.merchant_onboarding.completed_at, now()),
    updated_at = now();

  return jsonb_build_object(
    'providerId', p_provider_id,
    'serviceId', v_service_id,
    'publishReady', p_publish_ready,
    'completed', true
  );
end;
$$;

revoke all on table app.merchant_onboarding from public, anon, authenticated;
grant all on table app.merchant_onboarding to service_role;
revoke all on function app.create_merchant_onboarding_v1() from public, anon, authenticated;
revoke all on function public.get_merchant_onboarding_v1(uuid) from public, anon, authenticated;
revoke all on function public.save_merchant_onboarding_draft_v1(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.complete_merchant_onboarding_v1(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.get_merchant_onboarding_v1(uuid) to service_role;
grant execute on function public.save_merchant_onboarding_draft_v1(uuid, integer, jsonb) to service_role;
grant execute on function public.complete_merchant_onboarding_v1(uuid, jsonb, boolean) to service_role;
