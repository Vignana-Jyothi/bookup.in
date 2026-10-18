begin;
do $$
declare merchant uuid; contact uuid:=gen_random_uuid(); slug text; product uuid:=gen_random_uuid(); plan uuid:=gen_random_uuid();
  booking uuid; free_product uuid:=gen_random_uuid(); key_hash text:=encode(sha256(gen_random_bytes(32)),'hex');
  o jsonb; other jsonb; claim jsonb; worker uuid:=gen_random_uuid(); new_worker uuid:=gen_random_uuid(); first_end timestamptz;
begin
  assert not has_table_privilege('anon','public.commerce_orders','select');
  assert not has_table_privilege('authenticated','public.commerce_membership_periods','select');
  assert not has_function_privilege('authenticated','public.begin_commerce_order_v1(text,text,uuid,integer,text)','execute');
  select a.provider_id,a.id into merchant,booking from app.appointments a join app.merchant_entitlements e on e.provider_id=a.provider_id limit 1;
  if merchant is null then raise exception 'Needs staging merchant with an appointment and entitlement'; end if;
  select p.slug into slug from public.providers p where p.id=merchant;
  update app.merchant_entitlements set status='active',starts_at=now()-interval '1 day',expires_at=now()+interval '30 days',grace_ends_at=now()+interval '35 days' where provider_id=merchant;
  insert into public.commerce_contacts(id,provider_id,phone) values(contact,merchant,'9'||lpad(floor(random()*1000000000)::text,9,'0'));
  insert into public.commerce_customer_sessions(token_hash,contact_id) values(key_hash,contact);
  insert into public.merchant_commerce_catalog(id,provider_id,kind,title,price_paise,duration_days,status,version)
    values(plan,merchant,'membership','Rollback membership',9900,7,'published',1);
  insert into public.merchant_commerce_catalog(id,provider_id,kind,title,price_paise,purchase_limit,content_type,status,version)
    values(product,merchant,'product','Rollback product',19900,1,'file','published',1),(free_product,merchant,'product','Rollback free claim',0,1,'file','published',1);
  begin
    perform public.begin_commerce_order_v1(key_hash,slug,plan,2,'stale-version-00001');
    raise exception 'Expected stale listing rejection';
  exception when others then assert sqlerrm='VERSION_CONFLICT',sqlerrm; end;
  o:=public.begin_commerce_order_v1(key_hash,slug,plan,1,'membership-key-00001');
  other:=public.begin_commerce_order_v1(key_hash,slug,plan,1,'membership-key-00001');
  assert o->>'id'=other->>'id';
  begin
    perform public.begin_commerce_order_v1(key_hash,slug,product,1,'membership-key-00001');
    raise exception 'Expected scope conflict';
  exception when others then assert sqlerrm='IDEMPOTENCY_CONFLICT',sqlerrm; end;
  begin
    perform public.begin_commerce_order_v1(key_hash,slug,plan,1,'membership-key-00002');
    raise exception 'Expected existing checkout gate';
  exception when others then assert sqlerrm='ORDER_ACTIVE',sqlerrm; end;
  claim:=public.operate_commerce_order_v1((o->>'id')::uuid,'claim',worker);
  assert claim->>'dispatch'='true';
  assert public.operate_commerce_order_v1((o->>'id')::uuid,'claim',new_worker) is null;
  update public.commerce_orders set lease_until=clock_timestamp()-interval '1 second' where id=(o->>'id')::uuid;
  other:=public.operate_commerce_order_v1((o->>'id')::uuid,'claim',new_worker);
  assert other->>'dispatch'='false','Reclaimed workers must not send another create';
  begin
    perform public.operate_commerce_order_v1((o->>'id')::uuid,'success',worker,(claim->>'generation')::integer,p_payment=>'stale-worker');
    raise exception 'Expected stale completion denial';
  exception when others then assert sqlerrm='STALE_LEASE',sqlerrm; end;
  perform public.operate_commerce_order_v1((o->>'id')::uuid,'ready',new_worker,(other->>'generation')::integer,p_session=>'encrypted-test-session');
  assert (select checkout_state='ready' and encrypted_session='encrypted-test-session' and lease_owner is null from public.commerce_orders where id=(o->>'id')::uuid);
  other:=public.operate_commerce_order_v1((o->>'id')::uuid,'claim',new_worker);
  assert other->>'dispatch'='false';
  perform public.operate_commerce_order_v1((o->>'id')::uuid,'success',new_worker,(other->>'generation')::integer,p_payment=>'membership-test-payment-1');
  assert (select fulfilment_status='fulfilled' and amount_paise=9900 from public.commerce_orders where id=(o->>'id')::uuid);
  select ends_at into first_end from public.commerce_membership_periods where order_id=(o->>'id')::uuid;
  assert first_end>now()+interval '6 days 23 hours';
  assert exists(select 1 from ops.audit_events where aggregate_id=(o->>'id')::uuid and action='commerce.checkout_ready');
  assert exists(select 1 from ops.audit_events where aggregate_id=(o->>'id')::uuid and action='commerce.order_claimed');
  assert (select encrypted_session is null from public.commerce_orders where id=(o->>'id')::uuid);
  assert public.operate_commerce_order_v1((o->>'id')::uuid,'claim',worker) is null;
  o:=public.begin_commerce_order_v1(key_hash,slug,plan,1,'membership-key-00002');
  claim:=public.operate_commerce_order_v1((o->>'id')::uuid,'claim',worker);
  perform public.operate_commerce_order_v1((o->>'id')::uuid,'success',worker,(claim->>'generation')::integer,p_payment=>'membership-test-payment-2');
  assert (select starts_at=first_end and ends_at=first_end+interval '7 days' from public.commerce_membership_periods where order_id=(o->>'id')::uuid),'Early renewal must follow existing access exactly once';
  o:=public.begin_commerce_order_v1(key_hash,slug,plan,1,'membership-key-00003');
  claim:=public.operate_commerce_order_v1((o->>'id')::uuid,'claim',worker);
  perform public.operate_commerce_order_v1((o->>'id')::uuid,'rejected',worker,(claim->>'generation')::integer);
  claim:=public.operate_commerce_order_v1((o->>'id')::uuid,'claim',worker);
  perform public.operate_commerce_order_v1((o->>'id')::uuid,'success',worker,(claim->>'generation')::integer,p_payment=>'membership-rejected-late-payment');
  assert (select payment_status='succeeded' and fulfilment_status='review_required' from public.commerce_orders where id=(o->>'id')::uuid),'Late truth must not revive a rejected checkout';
  assert not exists(select 1 from public.commerce_membership_periods where order_id=(o->>'id')::uuid);
  begin
    perform public.begin_commerce_order_v1(key_hash,slug,product,1,'product-key-000001');
    raise exception 'Expected product approval gate';
  exception when others then assert sqlerrm='APPROVAL_REQUIRED',sqlerrm; end;
  insert into public.commerce_access_requests(product_id,contact_id,booking_id,status) values(product,contact,booking,'approved'),(free_product,contact,booking,'approved');
  o:=public.begin_commerce_order_v1(key_hash,slug,product,1,'product-key-000001');
  claim:=public.operate_commerce_order_v1((o->>'id')::uuid,'claim',worker);
  update public.commerce_orders set expires_at=now()-interval '1 second' where id=(o->>'id')::uuid;
  perform public.operate_commerce_order_v1((o->>'id')::uuid,'success',worker,(claim->>'generation')::integer,p_payment=>'product-late-payment-1');
  assert (select payment_status='succeeded' and fulfilment_status='review_required' from public.commerce_orders where id=(o->>'id')::uuid);
  assert exists(select 1 from public.commerce_payment_reviews where order_id=(o->>'id')::uuid);
  assert (select status='review_required' from public.commerce_purchase_reservations where id=(o->>'reservation_id')::uuid);
  begin
    perform public.begin_commerce_order_v1(key_hash,slug,product,1,'product-key-000002');
    raise exception 'Expected review case to count allowance';
  exception when others then assert sqlerrm='PURCHASE_LIMIT',sqlerrm; end;
  other:=public.reserve_commerce_purchase_v1(key_hash,slug,free_product,'expired-free-key-001');
  update public.commerce_purchase_reservations set expires_at=now()-interval '1 second' where id=(other->>'id')::uuid;
  begin
    perform public.begin_commerce_order_v1(key_hash,slug,free_product,1,'expired-free-key-001');
    raise exception 'Expected stale reservation denial';
  exception when others then assert sqlerrm='RESERVATION_EXPIRED',sqlerrm; end;
  o:=public.begin_commerce_order_v1(key_hash,slug,free_product,1,'free-claim-key-00001');
  assert o->>'payment_status'='not_required' and o->>'fulfilment_status'='awaiting_delivery';
  assert (select status='consumed' from public.commerce_purchase_reservations where id=(o->>'reservation_id')::uuid);
  assert public.operate_commerce_order_v1((o->>'id')::uuid,'claim',worker) is null;
  update app.merchant_entitlements set status='frozen' where provider_id=merchant;
  assert public.begin_commerce_otp_v1(slug,(select phone from public.commerce_contacts where id=contact),null,encode(sha256(gen_random_bytes(32)),'hex')) is not null,'Frozen merchants must not prevent verified financial-history access';
  begin
    perform public.begin_commerce_order_v1(key_hash,slug,plan,1,'frozen-new-order-001');
    raise exception 'Expected frozen purchase denial';
  exception when others then assert sqlerrm='ACCESS_UNAVAILABLE',sqlerrm; end;
  update public.commerce_customer_sessions set expires_at=now()-interval '1 second' where token_hash=key_hash;
  begin
    perform public.begin_commerce_order_v1(key_hash,slug,plan,1,'expired-session-001');
    raise exception 'Expected expired session denial';
  exception when others then assert sqlerrm='AUTH_REQUIRED',sqlerrm; end;
end $$;
rollback;
