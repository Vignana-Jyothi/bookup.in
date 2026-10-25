begin;
do $$
declare
  merchant uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid();
  lease1 uuid:=gen_random_uuid(); lease2 uuid:=gen_random_uuid();
  result jsonb; n integer;
  envelope text:=repeat('a',24)||':'||repeat('b',32)||':abcd';
begin
  insert into public.providers(id,name,slug) values(merchant,'OTP isolated fixture','otp-fixture-'||merchant::text);
  assert not has_function_privilege('anon','public.merchant_phone_operation_v2(uuid,text,text,uuid,text,uuid,boolean,boolean)','execute');
  assert not has_function_privilege('authenticated','public.merchant_phone_operation_v2(uuid,text,text,uuid,text,uuid,boolean,boolean)','execute');
  result:=public.merchant_phone_operation_v2(merchant,'9000000001','begin_send',request_id);
  assert (result->>'started')::boolean;
  result:=public.merchant_phone_operation_v2(merchant,'9000000001','finish_send',request_id,envelope);
  assert (result->>'sent')::boolean;
  assert (select phone_verification_session_id is null from app.merchant_onboarding where provider_id=merchant);
  assert (public.get_merchant_phone_verification_v1(merchant,'9000000001')->>'sent')::boolean;
  assert public.merchant_phone_operation_v2(merchant,'9000000002','reserve_verify',p_lease_id=>lease1)->>'reason'='not_requested';
  result:=public.merchant_phone_operation_v2(merchant,'9000000001','reserve_verify',p_lease_id=>lease1);
  assert (result->>'reserved')::boolean;
  assert result->>'ciphertext'=envelope;
  assert public.merchant_phone_operation_v2(merchant,'9000000001','reserve_verify',p_lease_id=>lease2)->>'reason'='busy';
  assert (select phone_verification_attempts=1 from app.merchant_onboarding where provider_id=merchant);
  assert public.merchant_phone_operation_v2(merchant,'9000000001','finish_verify',request_id,p_lease_id=>lease2,p_verified=>true)->>'reason'='stale';
  result:=public.merchant_phone_operation_v2(merchant,'9000000001','finish_verify',request_id,p_lease_id=>lease1);
  assert result->>'remainingAttempts'='4';
  for n in 2..5 loop
    result:=public.merchant_phone_operation_v2(merchant,'9000000001','reserve_verify',p_lease_id=>lease1);
    assert (result->>'reserved')::boolean;
    result:=public.merchant_phone_operation_v2(merchant,'9000000001','finish_verify',request_id,p_lease_id=>lease1);
  end loop;
  assert result->>'reason'='attempts_exceeded';
  assert public.merchant_phone_operation_v2(merchant,'9000000001','reserve_verify',p_lease_id=>lease2)->>'reason'='attempts_exceeded';

  -- Expired leases can be reclaimed; their late worker cannot succeed.
  update app.merchant_onboarding set phone_verification_attempts=0 where provider_id=merchant;
  perform public.merchant_phone_operation_v2(merchant,'9000000001','reserve_verify',p_lease_id=>lease1);
  update app.merchant_onboarding set phone_verification_lease_until=clock_timestamp()-interval '1 second' where provider_id=merchant;
  perform public.merchant_phone_operation_v2(merchant,'9000000001','reserve_verify',p_lease_id=>lease2);
  assert public.merchant_phone_operation_v2(merchant,'9000000001','finish_verify',request_id,p_lease_id=>lease1,p_verified=>true)->>'reason'='stale';
  result:=public.merchant_phone_operation_v2(merchant,'9000000001','finish_verify',request_id,p_lease_id=>lease2,p_verified=>true);
  assert (result->>'verified')::boolean;
  assert (select phone_verification_ciphertext is null and phone_verification_session_id is null from app.merchant_onboarding where provider_id=merchant);

  -- A legacy challenge still works, but through the new reservation gate.
  request_id:=gen_random_uuid();
  update app.merchant_onboarding set phone_verified_at=null,phone_verification_sent_at=null where provider_id=merchant;
  perform public.start_merchant_phone_verification_v1(merchant,'9000000001',request_id,clock_timestamp()+interval '10 minutes');
  perform public.complete_merchant_phone_verification_send_v1(merchant,request_id,'isolated-legacy-session');
  result:=public.merchant_phone_operation_v2(merchant,'9000000001','reserve_verify',p_lease_id=>lease1);
  assert result->>'legacySession'='isolated-legacy-session';
  update app.merchant_onboarding set phone_verification_expires_at=clock_timestamp()-interval '1 second' where provider_id=merchant;
  assert public.merchant_phone_operation_v2(merchant,'9000000001','finish_verify',request_id,p_lease_id=>lease1,p_verified=>true)->>'reason'='expired';
  assert (select phone_verified_at is null from app.merchant_onboarding where provider_id=merchant);

  -- Resending fences previous responses, including a still-live verification lease.
  update app.merchant_onboarding set phone_verification_sent_at=null where provider_id=merchant;
  request_id:=gen_random_uuid();
  perform public.merchant_phone_operation_v2(merchant,'9000000001','begin_send',request_id);
  perform public.merchant_phone_operation_v2(merchant,'9000000001','finish_send',request_id,envelope);
  perform public.merchant_phone_operation_v2(merchant,'9000000001','reserve_verify',p_lease_id=>lease1);
  update app.merchant_onboarding set phone_verification_sent_at=null where provider_id=merchant;
  perform public.merchant_phone_operation_v2(merchant,'9000000001','begin_send',gen_random_uuid());
  assert public.merchant_phone_operation_v2(merchant,'9000000001','finish_verify',request_id,p_lease_id=>lease1,p_verified=>true)->>'reason'='stale';
end $$;
rollback;
