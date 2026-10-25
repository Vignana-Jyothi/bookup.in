-- Explicit projections only. Never select token, billing snapshot or OTP payload columns.
create or replace view public.calup_admin_records_v1 as
select 'merchants'::text section, p.id::text id, coalesce(p.slug,p.id::text) reference,
  coalesce(nullif(p.business_name,''),p.name) issue, p.name merchant,
  case when e.provider_id is null then 'no_access' when e.status in ('frozen','deletion_scheduled','operational_deleted') then e.status when e.grace_ends_at<=now() then 'frozen' when e.expires_at<=now() then 'grace' else e.status end status,
  null::bigint amount_paise, 'INR'::text currency, 'account'::text kind,p.created_at occurred_at,
  null::uuid ticket_id, false attention,false overdue,
  jsonb_build_object('Business',p.business_name,'Email',p.email,'Phone',p.phone,'Booking page',p.slug,'Onboarding',o.status,
    'Access source',e.source,'Access expires',e.expires_at,'Grace ends',e.grace_ends_at,'Frozen at',e.frozen_at,'Retention deadline',e.deletion_scheduled_at) detail
from public.providers p left join app.merchant_entitlements e on e.provider_id=p.id left join app.merchant_onboarding o on o.provider_id=p.id
union all
select 'bookings',o.id::text,coalesce(a.booking_reference,o.id::text),
  case when o.purpose='subscription' then 'Subscription payment' else coalesce(s.name,'Service payment') end,
  coalesce(p.business_name,p.name),o.payment_status||' / '||o.fulfilment_status,o.amount_paise,o.currency,'financial',o.created_at,
  null::uuid,o.payment_status='creation_unknown' or (o.payment_status='succeeded' and o.fulfilment_status='unfulfilled'),false,
  jsonb_build_object('Payment',o.payment_status,'Fulfilment',o.fulfilment_status,'Environment',o.environment,'Purpose',o.purpose,
    'Appointment',a.status,'Starts',a.starts_at,'Ends',a.ends_at,'Customer',a.customer_name,'Calendar',a.calendar_sync_status,'Paid at',o.paid_at)
from finance.payment_orders o join public.providers p on p.id=o.provider_id
left join app.appointments a on a.payment_order_id=o.id left join public.services s on s.id=a.service_id
union all
select 'bookings','legacy-'||b.id::text,coalesce(b.booking_reference,b.id::text),coalesce(s.name,'Legacy booking'),
  coalesce(p.business_name,p.name),coalesce(b.payment_status,'unknown')||' / '||b.status,round(b.price*100)::bigint,'INR','financial',b.created_at,
  null::uuid,false,false,jsonb_build_object('Source','Legacy booking','Appointment',b.status,'Payment',b.payment_status,'Date',b.booking_date,
    'Starts',b.start_time,'Ends',b.end_time,'Customer',b.customer_name,'Environment','Legacy / not recorded')
from public.bookings b join public.providers p on p.id=b.provider_id left join public.services s on s.id=b.service_id
where not exists(select 1 from app.appointments a where a.booking_reference=b.booking_reference)
union all
select 'refunds',r.id::text,r.reference,'Merchant refund request',coalesce(p.business_name,p.name),r.status,r.amount_paise,r.currency,'financial',r.created_at,
  r.ticket_id,r.status not in ('refunded','rejected'),false,
  jsonb_build_object('Booking',a.booking_reference,'Reason',r.reason,'Payment',o.payment_status,'Fulfilment',o.fulfilment_status,
    'Environment',o.environment,'Appointment',a.status,'Version',r.version)
from public.booking_refund_requests r join public.providers p on p.id=r.provider_id
left join app.appointments a on a.id=r.appointment_id left join finance.payment_orders o on o.id=r.payment_order_id
union all
select 'refunds','resolution-'||c.id::text,c.id::text,'Payment recovery case',coalesce(p.business_name,p.name),c.status,o.amount_paise,o.currency,'financial',c.created_at,
  null::uuid,c.resolved_at is null,c.review_due_at<now() and c.resolved_at is null,
  jsonb_build_object('Reason',c.reason,'Payment',o.payment_status,'Fulfilment',o.fulfilment_status,'Environment',o.environment,'Review due',c.review_due_at,'Resolved',c.resolved_at)
from finance.payment_resolution_cases c join finance.payment_orders o on o.id=c.payment_order_id join public.providers p on p.id=c.provider_id
union all
select 'refunds','gateway-'||r.id::text,r.id::text,'Gateway refund record',coalesce(p.business_name,p.name),r.status,r.amount_paise,r.currency,'financial',r.created_at,
  null::uuid,r.status not in ('succeeded','rejected'),false,
  jsonb_build_object('Environment',o.environment,'Purpose',o.purpose,'Payment',o.payment_status,'Reason',r.reason,'Updated',r.updated_at,'Next reconciliation',r.next_reconcile_at)
from finance.refunds_v1 r join finance.payment_orders o on o.id=r.payment_order_id join public.providers p on p.id=o.provider_id
union all
select 'support',t.id::text,t.reference,t.subject,coalesce(p.business_name,p.name),t.status,null::bigint,'INR',
  case when t.financial_retention then 'financial' else 'support' end,t.created_at,t.id,
  t.assigned_to='calup' and t.status not in ('closed','resolved'),t.response_due_at<now() and t.acknowledged_at is null and t.status not in ('closed','resolved'),
  jsonb_build_object('Category',t.category,'Owner',t.assigned_to,'Booking',t.booking_reference,'Response due',t.response_due_at,'Acknowledged',t.acknowledged_at,'Escalated',t.escalated_at)
from public.support_tickets t join public.providers p on p.id=t.provider_id where t.purged_at is null
union all
select 'subscriptions',s.id::text,s.id::text,'Subscription order',coalesce(p.business_name,p.name),s.checkout_status||' / '||s.application_status,
  s.total_amount_paise,s.currency,'financial',s.created_at,null::uuid,false,false,
  jsonb_build_object('Checkout',s.checkout_status,'Entitlement application',s.application_status,'Applied',s.applied_at,'Expires',s.expires_at)
from finance.subscription_orders s join public.providers p on p.id=s.provider_id
union all
select 'subscriptions','review-'||r.id::text,r.id::text,'Subscription payment review',coalesce(p.business_name,p.name),r.status,null::bigint,'INR','financial',r.created_at,
  null::uuid,r.resolved_at is null,r.resolved_at is null and r.review_due_at<now(),jsonb_build_object('Reason',r.reason,'Review due',r.review_due_at,'Resolved',r.resolved_at)
from finance.subscription_payment_reviews r join public.providers p on p.id=r.provider_id
union all
select 'subscriptions','period-'||s.id::text,s.id::text,'Subscription access period',coalesce(p.business_name,p.name),s.status,null::bigint,'INR','account',s.created_at,
  null::uuid,false,false,jsonb_build_object('Starts',s.starts_at,'Ends',s.ends_at,'Cancelled',s.cancelled_at,'Refund record',s.refund_id)
from finance.subscription_periods s join public.providers p on p.id=s.provider_id
union all
select 'subscriptions','code-'||c.id::text,coalesce(c.code_hint,'Access code'), 'Access code',coalesce(p.business_name,p.name,'Unassigned'),c.status,null::bigint,'INR','account',c.created_at,
  null::uuid,false,false,jsonb_build_object('Duration days',c.duration_days,'Redemptions',c.redemption_count,'Maximum redemptions',c.max_redemptions,'Valid from',c.valid_from,'Valid until',c.valid_until,'Reason',c.reason)
from app.access_codes c left join public.providers p on p.id=c.bound_provider_id
union all
select 'integrations','calendar-'||a.id::text,a.booking_reference,'Google Calendar sync',coalesce(p.business_name,p.name),a.calendar_sync_status,null::bigint,'INR','integration',a.created_at,
  null::uuid,a.calendar_sync_status='dead_letter',false,jsonb_build_object('Attempts',a.calendar_sync_attempt_count,'Next attempt',a.calendar_sync_due_at,'Last synchronized',a.calendar_synced_at)
from app.appointments a join public.providers p on p.id=a.provider_id where a.meeting_type='online'
union all
select 'integrations','whatsapp-'||j.id::text,a.booking_reference,'Appointment WhatsApp',coalesce(p.business_name,p.name),j.status,null::bigint,'INR','integration',j.created_at,
  null::uuid,j.status in ('failed','review_required'),false,jsonb_build_object('Attempts',j.attempt_count,'Due',j.due_at,'Updated',j.updated_at)
from public.appointment_whatsapp_jobs j join app.appointments a on a.id=j.appointment_id join public.providers p on p.id=a.provider_id
union all
select 'audit','ops-'||e.id::text,e.id::text,e.action,coalesce(p.business_name,p.name,'Calup'),e.actor_type,null::bigint,'INR','audit',e.created_at,
  null::uuid,false,false,jsonb_build_object('Entity type',e.aggregate_type,'Entity',e.aggregate_id,'Actor type',e.actor_type)
from ops.audit_events e left join public.providers p on p.id=e.provider_id
union all
select 'audit','sms-'||e.id::text,'AUTH-'||e.id::text,e.event,'Calup staff','recorded',null::bigint,'INR','audit',e.created_at,
  null::uuid,false,false,jsonb_build_object('Actor user',e.user_id,'Source','Administrator SMS verification')
from public.admin_sms_events e
union all
select 'audit','legacy-'||e.id::text,e.id::text,e.action,coalesce(p.business_name,p.name,'Calup'),e.actor_type,null::bigint,'INR','audit',e.created_at,
  null::uuid,false,false,jsonb_build_object('Entity type',e.entity_type,'Entity',e.entity_id,'Actor type',e.actor_type)
from public.audit_logs e left join public.providers p on p.id=e.provider_id
union all
select 'audit','support-'||e.id::text,t.reference,e.action,coalesce(p.business_name,p.name),coalesce(e.next_status,'recorded'),null::bigint,'INR','audit',e.created_at,
  t.id,false,false,jsonb_build_object('Actor',e.actor,'Previous status',e.previous_status,'Next status',e.next_status)
from public.support_events e join public.support_tickets t on t.id=e.ticket_id join public.providers p on p.id=t.provider_id;
revoke all on public.calup_admin_records_v1 from public,anon,authenticated;
grant select on public.calup_admin_records_v1 to service_role;

create or replace function public.read_calup_admin_dashboard_v1(p_section text,p_period text default 'today',p_search text default '',p_filter text default 'all',p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare since timestamptz; result jsonb;
begin
  if p_section not in ('overview','merchants','bookings','refunds','support','subscriptions','integrations','audit')
    or p_period not in ('today','week','month','all') or p_filter not in ('all','financial','overdue')
    or p_offset<0 or p_offset>100000 or length(p_search)>120 then raise exception 'INVALID_FILTER'; end if;
  since:=case p_period when 'all' then '-infinity'::timestamptz when 'week' then (date_trunc('day',now() at time zone 'Asia/Kolkata')-interval '6 days') at time zone 'Asia/Kolkata'
    when 'month' then (date_trunc('day',now() at time zone 'Asia/Kolkata')-interval '29 days') at time zone 'Asia/Kolkata'
    else date_trunc('day',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' end;
  with matched as (
    select * from public.calup_admin_records_v1 r where (case when p_section='overview' then r.attention else r.section=p_section end)
      and r.occurred_at>=since and r.occurred_at<=now()
      and (p_filter='all' or (p_filter='financial' and r.kind='financial') or (p_filter='overdue' and r.overdue))
      and (p_search='' or strpos(lower(concat_ws(' ',r.reference,r.issue,r.merchant,r.status)),lower(p_search))>0)
  ), page as (select * from matched order by overdue desc,occurred_at desc,id limit 50 offset p_offset)
  select jsonb_build_object('records',coalesce((select jsonb_agg(jsonb_build_object('id',id,'section',section,'reference',reference,'issue',issue,'merchant',merchant,'status',status,
    'amountPaise',amount_paise,'currency',currency,'kind',kind,'createdAt',occurred_at,'ticketId',ticket_id,'overdue',overdue,'detail',detail) order by overdue desc,occurred_at desc,id) from page),'[]'::jsonb),
    'total',(select count(*) from matched),'since',case when p_period='all' then null else since end,'asOf',now(),
    'metrics',jsonb_build_object(
      'activeMerchants',(select count(*) from app.merchant_entitlements where status in ('active','grace') and starts_at<=now() and grace_ends_at>now()),
      'verifiedBookings',(select count(*) from app.appointments a join finance.payment_orders o on o.id=a.payment_order_id where a.created_at>=since and a.created_at<=now() and a.status<>'cancelled' and o.payment_status='succeeded'),
      'subscriptionReceiptsPaise',(select coalesce(sum(amount_paise),0) from finance.payment_orders where purpose='subscription' and payment_status='succeeded' and environment='production' and paid_at>=since and paid_at<=now()),
      'sandboxSubscriptionReceiptsPaise',(select coalesce(sum(amount_paise),0) from finance.payment_orders where purpose='subscription' and payment_status='succeeded' and environment='sandbox' and paid_at>=since and paid_at<=now()),
      'refundRequests',(select count(*) from public.booking_refund_requests where status not in ('refunded','rejected')),
      'refundAmountPaise',(select coalesce(sum(amount_paise),0) from public.booking_refund_requests where status not in ('refunded','rejected'))
    )) into result;
  return result;
end $$;
revoke all on function public.read_calup_admin_dashboard_v1(text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.read_calup_admin_dashboard_v1(text,text,text,text,integer) to service_role;
