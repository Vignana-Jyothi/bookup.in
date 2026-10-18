begin;

create table public.refund_calendar_cleanup_jobs (
  appointment_id uuid primary key references app.appointments(id) on delete restrict,
  status text not null default 'queued' check(status in ('queued','leased','succeeded')),
  due_at timestamptz not null default now(),
  lease_owner text,
  lease_generation bigint not null default 0,
  lease_until timestamptz,
  last_safe_error text
);
alter table public.refund_calendar_cleanup_jobs enable row level security;
revoke all on public.refund_calendar_cleanup_jobs from public,anon,authenticated;
grant all on public.refund_calendar_cleanup_jobs to service_role;

create function public.release_refunded_appointment_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare allocation uuid;
begin
  if new.status not in ('approved','processing','refunded') then return new; end if;
  select allocation_id into allocation from app.appointments where id=new.appointment_id for update;
  update app.slot_allocations set status='released',release_reason='refund_initiated',released_at=coalesce(released_at,clock_timestamp())
    where id=allocation and status in ('reserved','held','manual_review');
  update app.appointments set status='cancelled',meet_link=null,
    calendar_sync_status='not_required',calendar_lease_generation=calendar_lease_generation+1,
    calendar_lease_owner=null,calendar_lease_expires_at=null
    where id=new.appointment_id and status<>'cancelled';
  if old.status='requested' then
    insert into ops.audit_events(provider_id,aggregate_type,aggregate_id,action,actor_type,safe_metadata)
      values(new.provider_id,'appointment',new.appointment_id,'booking.refund_slot_released','system',jsonb_build_object('requestId',new.id));
  end if;
  return new;
end $$;
create trigger release_refunded_appointment after update of status on public.booking_refund_requests
  for each row execute function public.release_refunded_appointment_v1();

-- Keep cancellation durable, including a late event creation finishing after cancellation.
create function public.queue_refund_calendar_cleanup_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='cancelled' and new.meeting_type='online' and exists(
    select 1 from public.booking_refund_requests r where r.appointment_id=new.id and r.refund_id is not null
  ) then
    new.meet_link:=null;
    new.calendar_sync_status:='not_required';
    insert into public.refund_calendar_cleanup_jobs(appointment_id) values(new.id)
      on conflict(appointment_id) do update set status='queued',due_at=clock_timestamp(),
        lease_generation=public.refund_calendar_cleanup_jobs.lease_generation+1,lease_owner=null,lease_until=null;
  end if;
  return new;
end $$;
create trigger queue_refund_calendar_cleanup before update of status,google_event_id on app.appointments
  for each row execute function public.queue_refund_calendar_cleanup_v1();

create function public.claim_refund_calendar_cleanup_v1(p_owner text)
returns jsonb language sql security definer set search_path='' as $$
  with picked as (
    select appointment_id from public.refund_calendar_cleanup_jobs
    where due_at<=clock_timestamp() and (status='queued' or (status='leased' and lease_until<clock_timestamp()))
    order by due_at for update skip locked limit 1
  ), claimed as (
    update public.refund_calendar_cleanup_jobs j set status='leased',lease_owner=p_owner,
      lease_generation=j.lease_generation+1,lease_until=clock_timestamp()+interval '2 minutes'
    from picked where j.appointment_id=picked.appointment_id returning j.*
  ) select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'providerId',a.provider_id,
    'eventId',coalesce(a.google_event_id,'calup'||encode(extensions.digest(a.id::text,'sha256'),'hex')),'generation',j.lease_generation)),'[]'::jsonb)
  from claimed j join app.appointments a on a.id=j.appointment_id;
$$;
create function public.finish_refund_calendar_cleanup_v1(p_id uuid,p_owner text,p_generation bigint,p_success boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.refund_calendar_cleanup_jobs set status=case when p_success then 'succeeded' else 'queued' end,
    due_at=clock_timestamp()+interval '60 seconds',lease_owner=null,lease_until=null,
    last_safe_error=case when p_success then null else 'calendar_delete_failed' end
    where appointment_id=p_id and status='leased' and lease_owner=p_owner and lease_generation=p_generation and lease_until>clock_timestamp();
  return found;
end $$;
revoke all on function public.release_refunded_appointment_v1(),public.queue_refund_calendar_cleanup_v1(),
  public.claim_refund_calendar_cleanup_v1(text),public.finish_refund_calendar_cleanup_v1(uuid,text,bigint,boolean) from public,anon,authenticated;
grant execute on function public.claim_refund_calendar_cleanup_v1(text),public.finish_refund_calendar_cleanup_v1(uuid,text,bigint,boolean) to service_role;

-- Extend the current projection without replacing instructor/reference enhancements.
do $$
declare definition text; patched text;
begin
  definition:=pg_get_functiondef('public.get_merchant_cashfree_appointments_v1(uuid)'::regprocedure);
  patched:=replace(definition,'''paymentStatus'', ''confirmed'',',
    '''paymentStatus'', ''confirmed'',
    ''refundStatus'', coalesce((select r.status from public.booking_refund_requests r where r.appointment_id=a.id), ''none''),
    ''refundAmount'', coalesce((select r.amount_paise::numeric/100 from public.booking_refund_requests r where r.appointment_id=a.id),0),');
  if patched=definition then raise exception 'Merchant projection shape changed; review migration'; end if;
  execute patched;
  definition:=pg_get_functiondef('public.complete_google_calendar_sync_v1(uuid,text,bigint,boolean,text,text,text,integer)'::regprocedure);
  patched:=replace(definition,'if not found then return false; end if;',
    'if not found then
      if p_succeeded and p_google_event_id is not null then
        update app.appointments set google_event_id=p_google_event_id where id=p_appointment_id and status=''cancelled'';
      end if;
      return false;
    end if;');
  if patched=definition then raise exception 'Calendar completion shape changed; review migration'; end if;
  execute patched;
end $$;
commit;
