begin;
create table public.appointment_whatsapp_jobs (
  id uuid primary key default gen_random_uuid(), appointment_id uuid not null unique,
  status text not null default 'queued' check(status in ('queued','leased','sending','submitted','retry_wait','review_required','failed','cancelled')),
  lease_owner text, lease_generation bigint not null default 0, lease_expires_at timestamptz,
  attempt_count integer not null default 0, due_at timestamptz not null default now(),
  provider_message_id text, last_safe_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index appointment_whatsapp_due on public.appointment_whatsapp_jobs(status,due_at);
create table public.appointment_whatsapp_attempts (
  id bigint generated always as identity primary key, job_id uuid not null references public.appointment_whatsapp_jobs(id), generation bigint not null,
  status text not null check(status in ('sending','submitted','retry_wait','review_required','failed')),
  provider_message_id text, safe_error text, started_at timestamptz not null default now(), completed_at timestamptz, unique(job_id,generation)
);
alter table public.appointment_whatsapp_jobs enable row level security;
alter table public.appointment_whatsapp_attempts enable row level security;
revoke all on public.appointment_whatsapp_jobs,public.appointment_whatsapp_attempts from anon,authenticated;
grant all on public.appointment_whatsapp_jobs,public.appointment_whatsapp_attempts to service_role;
grant usage,select on sequence public.appointment_whatsapp_attempts_id_seq to service_role;

create function public.claim_appointment_whatsapp_v1(p_owner text,p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app,finance as $$
declare result jsonb;
begin
  if nullif(p_owner,'') is null then raise exception 'OWNER_REQUIRED'; end if;
  update public.appointment_whatsapp_attempts a set status='review_required',safe_error='send_outcome_unknown',completed_at=now()
    from public.appointment_whatsapp_jobs j where a.job_id=j.id and a.generation=j.lease_generation
      and j.status='sending' and j.lease_expires_at<=now() and a.status='sending';
  update public.appointment_whatsapp_jobs set status='review_required',last_safe_error='send_outcome_unknown',updated_at=now()
    where status='sending' and lease_expires_at<=now();
  update public.appointment_whatsapp_jobs set status='queued',lease_owner=null,lease_expires_at=null,updated_at=now()
    where status='leased' and lease_expires_at<=now();
  insert into public.appointment_whatsapp_jobs(appointment_id)
    select a.id from app.appointments a join finance.payment_orders o on o.id=a.payment_order_id
    where a.status='confirmed' and a.starts_at>now() and a.meeting_type='online' and a.calendar_sync_status='succeeded'
      and a.meet_link is not null and o.payment_status='succeeded' and o.fulfilment_status='fulfilled'
    on conflict(appointment_id) do nothing;
  with picked as (
    select j.id from public.appointment_whatsapp_jobs j where j.status in ('queued','retry_wait') and j.due_at<=now()
      order by j.due_at limit greatest(1,least(p_limit,25)) for update skip locked
  ), claimed as (
    update public.appointment_whatsapp_jobs j set status='leased',lease_owner=p_owner,
      lease_generation=j.lease_generation+1,lease_expires_at=now()+interval '60 seconds',updated_at=now()
    from picked where j.id=picked.id returning j.*
  ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into result from claimed;
  return result;
end;
$$;

create function public.begin_appointment_whatsapp_v1(p_job_id uuid,p_owner text,p_generation bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app,finance as $$
declare j public.appointment_whatsapp_jobs%rowtype; a app.appointments%rowtype; result jsonb;
begin
  select * into j from public.appointment_whatsapp_jobs where id=p_job_id and status='leased' and
    lease_owner=p_owner and lease_generation=p_generation and lease_expires_at>now() for update;
  if not found then return null; end if;
  select * into a from app.appointments where id=j.appointment_id;
  if not found or a.status<>'confirmed' or a.starts_at<=now() or a.meeting_type<>'online' or a.calendar_sync_status<>'succeeded' or a.meet_link is null or not exists (
    select 1 from finance.payment_orders o where o.id=a.payment_order_id and o.payment_status='succeeded' and o.fulfilment_status='fulfilled') then
    update public.appointment_whatsapp_jobs set status='cancelled',updated_at=now() where id=j.id;
    return null;
  end if;
  select jsonb_build_object('customerName',a.customer_name,'phone',a.customer_phone,'bookingId',a.booking_reference,
    'serviceName',s.name,'startsAt',a.starts_at,'timezone',coalesce(p.timezone,'Asia/Kolkata'),'meetLink',a.meet_link)
    into result from public.services s join public.providers p on p.id=a.provider_id where s.id=a.service_id;
  if result is null then return null; end if;
  update public.appointment_whatsapp_jobs set status='sending',attempt_count=attempt_count+1,updated_at=now() where id=j.id;
  insert into public.appointment_whatsapp_attempts(job_id,generation,status) values(j.id,p_generation,'sending');
  return result;
end;
$$;

create function public.complete_appointment_whatsapp_v1(p_job_id uuid,p_owner text,p_generation bigint,p_status text,p_message_id text,p_error text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.appointment_whatsapp_jobs%rowtype; next_status text;
begin
  if p_status is null or p_status not in ('submitted','retry_wait','review_required','failed') then raise exception 'INVALID_STATUS'; end if;
  if p_status='submitted' and nullif(p_message_id,'') is null then raise exception 'MESSAGE_ID_REQUIRED'; end if;
  select * into j from public.appointment_whatsapp_jobs where id=p_job_id and status='sending' and
    lease_owner=p_owner and lease_generation=p_generation and lease_expires_at>now() for update;
  if not found then return false; end if;
  next_status:=case when p_status='retry_wait' and j.attempt_count>=5 then 'failed' else p_status end;
  update public.appointment_whatsapp_attempts set status=next_status,provider_message_id=p_message_id,
    safe_error=left(p_error,100),completed_at=now() where job_id=j.id and generation=p_generation;
  update public.appointment_whatsapp_jobs set status=next_status,provider_message_id=p_message_id,last_safe_error=left(p_error,100),
    due_at=now()+make_interval(secs=>least(3600,60*j.attempt_count)),lease_owner=null,lease_expires_at=null,updated_at=now() where id=j.id;
  return true;
end;
$$;
revoke all on function public.claim_appointment_whatsapp_v1(text,integer),public.begin_appointment_whatsapp_v1(uuid,text,bigint),
  public.complete_appointment_whatsapp_v1(uuid,text,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_appointment_whatsapp_v1(text,integer),public.begin_appointment_whatsapp_v1(uuid,text,bigint),
  public.complete_appointment_whatsapp_v1(uuid,text,bigint,text,text,text) to service_role;
commit;
