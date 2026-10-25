-- Persisted gateway scope must be checked before gateway evidence or dispatch.
begin;

create or replace function public.get_cashfree_reconciliation_context_v1(p_attempt_id uuid)
returns jsonb language sql security definer set search_path = pg_catalog, app, finance
as $$
  select jsonb_build_object('environment', po.environment, 'gatewayAccount', po.gateway_account,
    'paymentPath', po.payment_path, 'purpose', po.purpose, 'attemptId', ba.id, 'paymentOrderId', po.id,
    'providerOrderId', po.provider_order_id, 'amountPaise', po.amount_paise,
    'currency', po.currency, 'paymentStatus', po.payment_status,
    'fulfilmentStatus', po.fulfilment_status, 'paymentSessionId', po.payment_session_id,
    'attemptStatus', ba.status, 'holdExpiresAt', ba.hold_expires_at,
    'remainingSeconds', greatest(0, floor(extract(epoch from (ba.hold_expires_at - clock_timestamp())))::integer),
    'appointmentId', (select id from app.appointments where booking_attempt_id = ba.id),
    'resolutionCaseId', (select id from finance.payment_resolution_cases where booking_attempt_id = ba.id))
  from app.booking_attempts ba join finance.payment_orders po on po.booking_attempt_id = ba.id
  where ba.id = p_attempt_id;
$$;
revoke all on function public.get_cashfree_reconciliation_context_v1(uuid) from public, anon, authenticated;
grant execute on function public.get_cashfree_reconciliation_context_v1(uuid) to service_role;

create or replace function public.get_subscription_reconciliation_context_v1(p_subscription_order_id uuid)
returns jsonb language sql security definer set search_path = pg_catalog, finance as $$
  select jsonb_build_object('environment', po.environment, 'gatewayAccount', po.gateway_account,
    'paymentPath', po.payment_path, 'purpose', po.purpose, 'orderId', so.id, 'providerId', so.provider_id,
    'paymentOrderId', po.id, 'providerOrderId', po.provider_order_id,
    'checkoutStatus', so.checkout_status, 'applicationStatus', so.application_status,
    'paymentStatus', po.payment_status, 'paymentSessionId', po.payment_session_id,
    'expiresAt', so.expires_at, 'amountPaise', po.amount_paise, 'currency', po.currency)
  from finance.subscription_orders so join finance.payment_orders po on po.subscription_order_id = so.id
  where so.id = p_subscription_order_id;
$$;
revoke all on function public.get_subscription_reconciliation_context_v1(uuid) from public, anon, authenticated;
grant execute on function public.get_subscription_reconciliation_context_v1(uuid) to service_role;

create or replace function public.get_subscription_refund_context_v1(p_refund_id uuid)
returns jsonb language sql security definer set search_path = pg_catalog, finance as $$
  select jsonb_build_object('environment', po.environment, 'gatewayAccount', po.gateway_account,
    'paymentPath', po.payment_path, 'purpose', po.purpose, 'refundId', r.id, 'providerId', po.provider_id,
    'providerOrderId', po.provider_order_id, 'amountPaise', r.amount_paise,
    'status', r.status, 'providerRefundId', r.provider_refund_id)
  from finance.refunds_v1 r join finance.payment_orders po on po.id = r.payment_order_id
  where r.id = p_refund_id and po.purpose = 'subscription';
$$;
revoke all on function public.get_subscription_refund_context_v1(uuid) from public, anon, authenticated;
grant execute on function public.get_subscription_refund_context_v1(uuid) to service_role;

create or replace function public.get_integration_release_readiness_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare base jsonb; signature text; context_oid oid; body text;
begin
  if pg_catalog.to_regprocedure('public.get_release_readiness_v1()') is null then
    return pg_catalog.jsonb_build_object('release','20261025-integration-audit','ready',false);
  end if;
  base := public.get_release_readiness_v1();
  if base->>'release' is distinct from '20261025-code-audit'
    or base->'ready' is distinct from 'true'::jsonb then
    return pg_catalog.jsonb_build_object('release','20261025-integration-audit','ready',false);
  end if;
  foreach signature in array array[
    'public.get_cashfree_reconciliation_context_v1(uuid)',
    'public.get_subscription_reconciliation_context_v1(uuid)',
    'public.get_subscription_refund_context_v1(uuid)'
  ] loop
    context_oid := pg_catalog.to_regprocedure(signature);
    if context_oid is null then
      return pg_catalog.jsonb_build_object('release','20261025-integration-audit','ready',false);
    end if;
    body := pg_catalog.lower(pg_catalog.pg_get_functiondef(context_oid));
    if pg_catalog.has_function_privilege('anon',context_oid,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',context_oid,'EXECUTE')
      or not pg_catalog.has_function_privilege('service_role',context_oid,'EXECUTE')
      or not exists(select 1 from pg_catalog.pg_proc where oid=context_oid and prosecdef)
      or pg_catalog.strpos(body,'''environment'', po.environment')=0
      or pg_catalog.strpos(body,'''gatewayaccount'', po.gateway_account')=0
      or pg_catalog.strpos(body,'''paymentpath'', po.payment_path')=0
      or pg_catalog.strpos(body,'''purpose'', po.purpose')=0 then
      return pg_catalog.jsonb_build_object('release','20261025-integration-audit','ready',false);
    end if;
  end loop;
  foreach signature in array array[
    'public.claim_payment_notification_jobs_v1(text,integer)',
    'public.get_payment_notification_context_v1(uuid,text,bigint,jsonb)',
    'public.get_booking_calendar_preflight_v1(uuid,uuid,text,text)',
    'public.begin_cashfree_order_dispatch_v1(uuid,text)',
    'public.finish_cashfree_event_scoped_v1(text,text,text,text,text)'
  ] loop
    context_oid := pg_catalog.to_regprocedure(signature);
    if context_oid is null then
      return pg_catalog.jsonb_build_object('release','20261025-integration-audit','ready',false);
    end if;
    if pg_catalog.has_function_privilege('anon',context_oid,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',context_oid,'EXECUTE')
      or not pg_catalog.has_function_privilege('service_role',context_oid,'EXECUTE')
      or not exists(select 1 from pg_catalog.pg_proc where oid=context_oid and prosecdef) then
      return pg_catalog.jsonb_build_object('release','20261025-integration-audit','ready',false);
    end if;
  end loop;
  body := pg_catalog.lower(pg_catalog.pg_get_functiondef('public.get_payment_notification_context_v1(uuid,text,bigint,jsonb)'::pg_catalog.regprocedure));
  if pg_catalog.strpos(body,'lease_expires_at>clock_timestamp()')=0
    or pg_catalog.strpos(body,'payment_status=''succeeded''')=0
    or pg_catalog.strpos(body,'fulfilment_status=''fulfilled''')=0
    or pg_catalog.strpos(body,'notification_snapshot')=0 then
    return pg_catalog.jsonb_build_object('release','20261025-integration-audit','ready',false);
  end if;
  body := pg_catalog.lower(pg_catalog.pg_get_functiondef('public.finish_cashfree_event_scoped_v1(text,text,text,text,text)'::pg_catalog.regprocedure));
  if pg_catalog.strpos(body,'environment=p_environment')=0 or pg_catalog.strpos(body,'gateway_account=p_gateway_account')=0 then
    return pg_catalog.jsonb_build_object('release','20261025-integration-audit','ready',false);
  end if;
  return pg_catalog.jsonb_build_object('release','20261025-integration-audit','ready',true);
exception when others then
  return pg_catalog.jsonb_build_object('release','20261025-integration-audit','ready',false);
end $$;
revoke all on function public.get_integration_release_readiness_v1() from public, anon, authenticated;
grant execute on function public.get_integration_release_readiness_v1() to service_role;
commit;

