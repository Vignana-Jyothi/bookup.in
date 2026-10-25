-- Read-only installed-definition contract; run only on an isolated migrated database.
do $$
declare body text;
begin
  body := pg_get_functiondef('public.begin_cashfree_order_dispatch_v1(uuid,text)'::regprocedure);
  if position('where id = p_payment_order_id for update' in body) = 0
    or position('payment_status = ''creation_unknown'', provider_order_id = p_provider_order_id' in body) = 0
    or position('where id = p_payment_order_id and payment_status = ''created''' in body) = 0
    or position('interval ''60 seconds''' in body) = 0
    or position('PROVIDER_ORDER_MISMATCH' in body) = 0 then
    raise exception 'Cashfree dispatch must persist identity atomically before provider I/O';
  end if;
  if has_function_privilege('anon','public.begin_cashfree_order_dispatch_v1(uuid,text)','EXECUTE')
    or has_function_privilege('authenticated','public.begin_cashfree_order_dispatch_v1(uuid,text)','EXECUTE')
    or not has_function_privilege('service_role','public.begin_cashfree_order_dispatch_v1(uuid,text)','EXECUTE') then
    raise exception 'Cashfree dispatch must remain service-only';
  end if;
end $$;
