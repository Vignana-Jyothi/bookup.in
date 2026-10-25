begin;
do $$
declare a app.appointments%rowtype; product uuid:=gen_random_uuid(); fixture_phone text:='9'||lpad(floor(random()*1000000000)::text,9,'0');
  challenge uuid; second_challenge uuid; owner1 uuid:=gen_random_uuid(); owner2 uuid:=gen_random_uuid(); result jsonb; request jsonb; reservation jsonb; replay jsonb;
begin
  assert not has_table_privilege('authenticated','public.commerce_customer_sessions','select');
  assert not has_function_privilege('anon','public.reserve_commerce_purchase_v1(text,text,uuid,text)','execute');
  select ap.* into a from app.appointments ap join finance.payment_orders o on o.id=ap.payment_order_id
    join app.merchant_entitlements e on e.provider_id=ap.provider_id
    where o.payment_status='succeeded' and o.fulfilment_status='fulfilled'
      and not exists(select 1 from public.booking_refund_requests where appointment_id=ap.id) limit 1;
  if not found then raise exception 'Needs paid appointment with a merchant entitlement'; end if;
  -- Historical fixture only inside rollback; no slot or external calendar mutations.
  update app.appointments set customer_phone=fixture_phone,status='confirmed',starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=a.id;
  update app.merchant_entitlements set status='frozen' where provider_id=a.provider_id;
  perform public.save_merchant_commerce_item_v1(a.provider_id,product,'product',0,'Access test product','',0,1,null,'file','draft');
  begin
    perform public.publish_commerce_item_v1(a.provider_id,product,1,true);
    raise exception 'Expected frozen publication denial';
  exception when others then assert sqlerrm='MERCHANT_INACTIVE',sqlerrm; end;
  update app.merchant_entitlements set status='active',starts_at=now()-interval '1 day',expires_at=now()+interval '30 days',grace_ends_at=now()+interval '35 days' where provider_id=a.provider_id;
  begin
    perform public.publish_commerce_item_v1(a.provider_id,product,1,true);
    raise exception 'Expected content gate';
  exception when others then assert sqlerrm='CONTENT_REQUIRED',sqlerrm; end;
  insert into public.merchant_commerce_assets(product_id,object_path,envelope,status) values(product,'rollback-test/'||product,'{}','ready');
  result:=public.publish_commerce_item_v1(a.provider_id,product,1,true); assert result->>'status'='published';
  begin
    perform public.save_merchant_commerce_item_v1(a.provider_id,product,'product',2,'Cannot silently edit live','',100,2,null,'file','draft');
    raise exception 'Expected live edit denial';
  exception when others then assert sqlerrm='ITEM_PUBLISHED',sqlerrm; end;
  challenge:=public.begin_commerce_otp_v1((select slug from public.providers where id=a.provider_id),fixture_phone,a.booking_reference,repeat('d',64));
  begin
    perform public.begin_commerce_otp_v1((select slug from public.providers where id=a.provider_id),fixture_phone,a.booking_reference,repeat('d',64));
    raise exception 'Expected SMS cooldown';
  exception when others then assert sqlerrm='OTP_RATE_LIMIT',sqlerrm; end;
  perform public.operate_commerce_otp_v1(challenge,'sent',p_session=>'encrypted-test-session');
  result:=public.operate_commerce_otp_v1(challenge,'reserve_verify',owner1); assert result->>'encryptedSession'='encrypted-test-session';
  begin
    perform public.operate_commerce_otp_v1(challenge,'reserve_verify',owner2);
    raise exception 'Expected concurrent verification denial';
  exception when others then assert sqlerrm='OTP_BUSY',sqlerrm; end;
  result:=public.operate_commerce_otp_v1(challenge,'finish_verify',owner1,p_verified=>false); assert result->>'verified'='false';
  perform public.operate_commerce_otp_v1(challenge,'reserve_verify',owner2);
  result:=public.operate_commerce_otp_v1(challenge,'finish_verify',owner2,p_token_hash=>repeat('b',64),p_verified=>true); assert result->>'verified'='true';
  assert (select encrypted_session from public.commerce_otp_challenges where id=challenge) is null;
  begin
    perform public.operate_commerce_otp_v1(challenge,'reserve_verify',owner1);
    raise exception 'Expected used OTP denial';
  exception when others then assert sqlerrm='OTP_INVALID',sqlerrm; end;
  insert into public.commerce_otp_challenges(provider_id,phone,booking_id,ip_hash,status,encrypted_session,attempts)
    values(a.provider_id,fixture_phone,a.id,repeat('e',64),'sent','encrypted-test-session',4) returning id into second_challenge;
  perform public.operate_commerce_otp_v1(second_challenge,'reserve_verify',owner1);
  perform public.operate_commerce_otp_v1(second_challenge,'finish_verify',owner1,p_verified=>false);
  begin
    perform public.operate_commerce_otp_v1(second_challenge,'reserve_verify',owner1);
    raise exception 'Expected five-attempt cap';
  exception when others then assert sqlerrm='OTP_INVALID',sqlerrm; end;
  request:=public.request_commerce_access_v1(repeat('b',64),(select slug from public.providers where id=a.provider_id),product);
  replay:=public.request_commerce_access_v1(repeat('b',64),(select slug from public.providers where id=a.provider_id),product);
  assert request->>'id'=replay->>'id' and request->>'status'='pending';
  begin
    perform public.reserve_commerce_purchase_v1(repeat('b',64),(select slug from public.providers where id=a.provider_id),product,'before-approval-test001');
    raise exception 'Expected approval gate';
  exception when others then assert sqlerrm='APPROVAL_REQUIRED',sqlerrm; end;
  result:=public.decide_commerce_access_v1(a.provider_id,(request->>'id')::uuid,1,'approved','Attendance verified for this rollback fixture.');
  assert result->>'status'='approved';
  reservation:=public.reserve_commerce_purchase_v1(repeat('b',64),(select slug from public.providers where id=a.provider_id),product,'purchase-limit-test001');
  assert (reservation->>'amount_paise')::bigint=0;
  replay:=public.reserve_commerce_purchase_v1(repeat('b',64),(select slug from public.providers where id=a.provider_id),product,'purchase-limit-test001');
  assert replay->>'id'=reservation->>'id';
  begin
    perform public.reserve_commerce_purchase_v1(repeat('b',64),(select slug from public.providers where id=a.provider_id),product,'purchase-limit-test002');
    raise exception 'Expected per-customer limit';
  exception when others then assert sqlerrm='PURCHASE_LIMIT',sqlerrm; end;
  update public.commerce_purchase_reservations set expires_at=now()-interval '1 second' where id=(reservation->>'id')::uuid;
  reservation:=public.reserve_commerce_purchase_v1(repeat('b',64),(select slug from public.providers where id=a.provider_id),product,'purchase-limit-test003');
  update public.commerce_purchase_reservations set status='consumed' where id=(reservation->>'id')::uuid;
  -- Another verified session for the same phone must reuse identity and allowance.
  insert into public.commerce_otp_challenges(provider_id,phone,booking_id,ip_hash,status,encrypted_session)
    values(a.provider_id,fixture_phone,a.id,repeat('e',64),'sent','encrypted-test-session') returning id into second_challenge;
  perform public.operate_commerce_otp_v1(second_challenge,'reserve_verify',owner1);
  perform public.operate_commerce_otp_v1(second_challenge,'finish_verify',owner1,p_token_hash=>repeat('c',64),p_verified=>true);
  assert (select count(*) from public.commerce_contacts c where c.provider_id=a.provider_id and c.phone=fixture_phone)=1;
  begin
    perform public.reserve_commerce_purchase_v1(repeat('c',64),(select slug from public.providers where id=a.provider_id),product,'purchase-limit-test004');
    raise exception 'Expected stable customer limit';
  exception when others then assert sqlerrm='PURCHASE_LIMIT',sqlerrm; end;
  perform public.decide_commerce_access_v1(a.provider_id,(request->>'id')::uuid,2,'revoked','Merchant revoked access after test review.');
  begin
    perform public.reserve_commerce_purchase_v1(repeat('c',64),(select slug from public.providers where id=a.provider_id),product,'purchase-limit-test005');
    raise exception 'Expected revoked access denial';
  exception when others then assert sqlerrm='APPROVAL_REQUIRED',sqlerrm; end;
  update public.commerce_customer_sessions set expires_at=now()-interval '1 second' where token_hash=repeat('c',64);
  assert public.commerce_session_v1(repeat('c',64),(select slug from public.providers where id=a.provider_id)) is null;
end $$;
rollback;
