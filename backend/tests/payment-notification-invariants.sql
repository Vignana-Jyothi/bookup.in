-- Read-only installed contracts; execute only in the isolated test database.
do $$
declare signature text; body text;
begin
  foreach signature in array array[
    'public.claim_payment_notification_jobs_v1(text,integer)',
    'public.get_payment_notification_context_v1(uuid,text,bigint,jsonb)',
    'public.finish_cashfree_event_scoped_v1(text,text,text,text,text)'
  ] loop
    if has_function_privilege('anon',signature,'EXECUTE') or has_function_privilege('authenticated',signature,'EXECUTE')
      or not has_function_privilege('service_role',signature,'EXECUTE') then
      raise exception 'Payment notification/scoped webhook RPC must remain private';
    end if;
  end loop;
  body := pg_get_functiondef('public.get_payment_notification_context_v1(uuid,text,bigint,jsonb)'::regprocedure);
  if position('lease_expires_at>clock_timestamp()' in body)=0 or position('o.fulfilment_status=''fulfilled''' in body)=0 then
    raise exception 'Notification delivery requires a current lease and payment state';
  end if;
end $$;
