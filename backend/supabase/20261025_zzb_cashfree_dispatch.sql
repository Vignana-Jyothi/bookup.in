begin;

-- Persist deterministic gateway identity before provider I/O; only one caller may dispatch.
create or replace function public.begin_cashfree_order_dispatch_v1(p_payment_order_id uuid, p_provider_order_id text)
returns boolean language plpgsql security definer set search_path = pg_catalog, finance as $$
declare current_order finance.payment_orders%rowtype; expected_reference text;
begin
  select * into current_order from finance.payment_orders where id = p_payment_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if current_order.payment_path <> 'cashfree' or current_order.purpose not in ('service_booking', 'subscription') then
    raise exception 'PAYMENT_SCOPE_MISMATCH';
  end if;
  if (current_order.purpose = 'subscription' and current_order.gateway_account <> 'calup_subscription')
    or (current_order.purpose = 'service_booking' and current_order.gateway_account <> 'calup_primary') then
    raise exception 'PAYMENT_SCOPE_MISMATCH';
  end if;
  expected_reference := case when current_order.purpose = 'subscription' then 'calup_sub_' else 'calup_' end
    || replace(current_order.id::text, '-', '');
  if p_provider_order_id is distinct from expected_reference
    or (current_order.provider_order_id is not null and current_order.provider_order_id <> p_provider_order_id) then
    raise exception 'PROVIDER_ORDER_MISMATCH';
  end if;
  if current_order.payment_status <> 'created' then return false; end if;
  update finance.payment_orders set payment_status = 'creation_unknown', provider_order_id = p_provider_order_id,
    next_reconcile_at = clock_timestamp() + interval '60 seconds', updated_at = clock_timestamp()
  where id = p_payment_order_id and payment_status = 'created';
  if not found then return false; end if;
  if current_order.subscription_order_id is not null then
    update finance.subscription_orders set checkout_status = 'pending', updated_at = clock_timestamp()
    where id = current_order.subscription_order_id and checkout_status = 'created';
  end if;
  return true;
end;
$$;

revoke all on function public.begin_cashfree_order_dispatch_v1(uuid,text) from public, anon, authenticated;
grant execute on function public.begin_cashfree_order_dispatch_v1(uuid,text) to service_role;

commit;
