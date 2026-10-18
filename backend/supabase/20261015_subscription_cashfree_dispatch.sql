begin;

create or replace function public.claim_cashfree_reconciliation_v1(p_limit integer default 25)
returns setof uuid language sql security definer set search_path = pg_catalog, finance
as $$
  with due as (
    select id
    from finance.payment_orders
    where purpose = 'service_booking'
      and payment_path = 'cashfree'
      and provider_order_id is not null
      and payment_status in ('creation_unknown', 'pending', 'closed_unpaid')
      and next_reconcile_at <= clock_timestamp()
    order by next_reconcile_at
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  ), claimed as (
    update finance.payment_orders po
    set reconcile_attempt_count = po.reconcile_attempt_count + 1,
        next_reconcile_at = clock_timestamp() + make_interval(secs => least(600, 30 * (po.reconcile_attempt_count + 1))),
        updated_at = clock_timestamp()
    from due
    where po.id = due.id
    returning po.booking_attempt_id
  )
  select booking_attempt_id from claimed where booking_attempt_id is not null;
$$;

create or replace function public.fail_subscription_order_creation_v1(
  p_subscription_order_id uuid, p_safe_error_code text
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, finance
as $$
declare v_provider_id uuid;
begin
  update finance.payment_orders
  set payment_status = 'creation_failed', last_safe_error_code = left(p_safe_error_code, 120),
      updated_at = clock_timestamp()
  where subscription_order_id = p_subscription_order_id
    and payment_status in ('created', 'creation_unknown')
  returning provider_id into v_provider_id;
  update finance.subscription_orders
  set checkout_status = 'expired', updated_at = clock_timestamp()
  where id = p_subscription_order_id and checkout_status in ('created', 'pending');
  if v_provider_id is null then raise exception 'NOT_FOUND'; end if;
  return public.get_merchant_subscription_v1(v_provider_id);
end;
$$;

revoke all on function public.fail_subscription_order_creation_v1(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_subscription_order_creation_v1(uuid, text) to service_role;

commit;
