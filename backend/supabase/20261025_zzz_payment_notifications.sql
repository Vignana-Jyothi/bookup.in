-- Durable per-recipient email delivery; Calendar/WhatsApp retain their own workers.
begin;
alter table ops.outbox_jobs add column if not exists notification_snapshot jsonb;
alter table ops.outbox_jobs add column if not exists notification_snapshot_at timestamptz;
create or replace function public.claim_payment_notification_jobs_v1(p_owner text,p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path='' as $$
declare parent ops.outbox_jobs%rowtype; result jsonb;
begin
  if nullif(btrim(p_owner),'') is null then raise exception 'OWNER_REQUIRED'; end if;
  for parent in select * from ops.outbox_jobs
    where effect_type in ('appointment_confirmed','payment_unfulfilled')
      and ((status='queued' and due_at<=clock_timestamp()) or (status='leased' and lease_expires_at<=clock_timestamp()))
    order by due_at for update skip locked limit greatest(1,least(p_limit,50))
  loop
    if parent.effect_type='appointment_confirmed' then
      insert into ops.outbox_jobs(effect_type,aggregate_type,aggregate_id,aggregate_version,recipient_or_purpose)
      values ('payment_confirmation_email',parent.aggregate_type,parent.aggregate_id,parent.aggregate_version,'customer'),
        ('payment_confirmation_email',parent.aggregate_type,parent.aggregate_id,parent.aggregate_version,'merchant')
      on conflict do nothing;
    else
      insert into ops.outbox_jobs(effect_type,aggregate_type,aggregate_id,aggregate_version,recipient_or_purpose)
      values ('payment_unfulfilled_email',parent.aggregate_type,parent.aggregate_id,parent.aggregate_version,'customer'),
        ('payment_unfulfilled_email',parent.aggregate_type,parent.aggregate_id,parent.aggregate_version,'support')
      on conflict do nothing;
    end if;
    update ops.outbox_jobs set status='succeeded',lease_owner=null,lease_expires_at=null,
      last_safe_error=null,updated_at=clock_timestamp() where id=parent.id;
  end loop;
  with picked as (
    select id from ops.outbox_jobs
    where effect_type in ('payment_confirmation_email','payment_unfulfilled_email')
      and ((status='queued' and due_at<=clock_timestamp())
        or (status='leased' and lease_expires_at<=clock_timestamp()))
    order by due_at for update skip locked limit greatest(1,least(p_limit,50))
  ), claimed as (
    update ops.outbox_jobs j set status='leased',lease_owner=p_owner,
      lease_generation=j.lease_generation+1,lease_expires_at=clock_timestamp()+interval '60 seconds',
      attempt_count=j.attempt_count+1,updated_at=clock_timestamp()
    from picked where j.id=picked.id returning j.*
  ) select coalesce(jsonb_agg(jsonb_build_object('jobId',id,'generation',lease_generation,
    'effectType',effect_type,'recipient',recipient_or_purpose)),'[]'::jsonb) into result from claimed;
  return result;
end $$;

drop function if exists public.get_payment_notification_context_v1(uuid,text,bigint);
create or replace function public.get_payment_notification_context_v1(
  p_job_id uuid,p_owner text,p_generation bigint,p_delivery_settings jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare job ops.outbox_jobs%rowtype; result jsonb; recipient text;
begin
  select * into job from ops.outbox_jobs where id=p_job_id and status='leased'
    and lease_owner=p_owner and lease_generation=p_generation and lease_expires_at>clock_timestamp() for update;
  if not found then return null; end if;
  if job.effect_type='payment_confirmation_email' then
    select jsonb_build_object('deliver',true,'environment',o.environment,'gatewayAccount',o.gateway_account,
      'paymentPath',o.payment_path,'purpose',o.purpose,'recipient',job.recipient_or_purpose,
      'customerEmail',a.customer_email,'customerPhone',a.customer_phone,'merchantEmail',p.email,'customerName',a.customer_name,
      'providerName',coalesce(p.business_name,p.name),'serviceName',coalesce(s.name,'Session'),
      'bookingReference',a.booking_reference,'bookingDate',to_char(a.starts_at at time zone coalesce(p.timezone,'Asia/Kolkata'),'YYYY-MM-DD'),
      'startTime',to_char(a.starts_at at time zone coalesce(p.timezone,'Asia/Kolkata'),'HH24:MI'),
      'duration',greatest(1,floor(extract(epoch from a.ends_at-a.starts_at)/60)::integer),
      'timezone',coalesce(p.timezone,'Asia/Kolkata'),'meetLink',a.meet_link)
    into result from app.appointments a join finance.payment_orders o on o.id=a.payment_order_id
      join public.providers p on p.id=a.provider_id left join public.services s on s.id=a.service_id
    where a.id=job.aggregate_id and a.status='confirmed'
      and o.payment_status='succeeded' and o.fulfilment_status='fulfilled';
  elsif job.effect_type='payment_unfulfilled_email' then
    select jsonb_build_object('deliver',true,'environment',o.environment,'gatewayAccount',o.gateway_account,
      'paymentPath',o.payment_path,'purpose',o.purpose,'recipient',job.recipient_or_purpose,
      'customerEmail',b.customer_email,'customerName',b.customer_name,'providerName',coalesce(p.business_name,p.name),
      'serviceName',coalesce(s.name,'Session'),'resolutionCaseId',c.id,'amountPaise',o.amount_paise,'currency',o.currency)
    into result from finance.payment_resolution_cases c join finance.payment_orders o on o.id=c.payment_order_id
      join app.booking_attempts b on b.id=c.booking_attempt_id join public.providers p on p.id=c.provider_id
      left join public.services s on s.id=b.service_id
    where c.id=job.aggregate_id and c.resolved_at is null
      and o.payment_status='succeeded' and o.fulfilment_status='unfulfilled';
  else return null;
  end if;
  -- Always recheck live state, even when a prior send already froze its payload.
  if result is null then return jsonb_build_object('deliver',false,'reason','state_no_longer_eligible'); end if;
  if job.notification_snapshot is not null then
    if job.notification_snapshot_at<clock_timestamp()-interval '23 hours' then
      return job.notification_snapshot || jsonb_build_object('reviewRequired',true);
    end if;
    return job.notification_snapshot;
  end if;
  result := result || jsonb_build_object('supportEmail',p_delivery_settings->>'supportEmail',
    'frontendUrl',p_delivery_settings->>'frontendUrl','fromEmail',p_delivery_settings->>'fromEmail',
    'calendarDomain',p_delivery_settings->>'calendarDomain','issuedAt',clock_timestamp());
  recipient := case job.recipient_or_purpose when 'support' then result->>'supportEmail'
    when 'merchant' then result->>'merchantEmail' else result->>'customerEmail' end;
  -- Missing configuration can recover later; never freeze an unusable address.
  if coalesce((p_delivery_settings->>'mailReady')::boolean,false)
    and result->>'environment'=p_delivery_settings->>'environment'
    and coalesce(recipient,'') ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and nullif(result->>'frontendUrl','') is not null then
    update ops.outbox_jobs set notification_snapshot=result,notification_snapshot_at=clock_timestamp()
    where id=job.id;
    return result;
  end if;
  return result || jsonb_build_object('configurationPending',true);
end $$;

create or replace function public.finish_cashfree_event_scoped_v1(
  p_event_key text,p_environment text,p_gateway_account text,p_status text,p_safe_error text
) returns void language plpgsql security definer set search_path='' as $$
begin
  if p_status not in ('processed','rejected','review_required') then raise exception 'INVALID_STATE_INPUT'; end if;
  update finance.gateway_events set status=p_status,safe_error=left(p_safe_error,120),processed_at=clock_timestamp()
  where provider='cashfree' and event_key=p_event_key and environment=p_environment
    and gateway_account=p_gateway_account and status in ('received','review_required');
end $$;
revoke all on function public.claim_payment_notification_jobs_v1(text,integer),
  public.get_payment_notification_context_v1(uuid,text,bigint,jsonb),
  public.finish_cashfree_event_scoped_v1(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_payment_notification_jobs_v1(text,integer),
  public.get_payment_notification_context_v1(uuid,text,bigint,jsonb),
  public.finish_cashfree_event_scoped_v1(text,text,text,text,text) to service_role;
commit;
