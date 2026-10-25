begin;
do $$
#variable_conflict use_variable
declare
  u uuid := gen_random_uuid(); s uuid := gen_random_uuid(); s2 uuid := gen_random_uuid();
  c uuid := gen_random_uuid(); l uuid := gen_random_uuid(); stale uuid; r jsonb; i integer;
  phone text := '+919000000001';
begin
  if has_table_privilege('authenticated','public.admin_sms_grants','select')
    or has_function_privilege('anon','public.verify_calup_admin_sms_session_v1(uuid,uuid,text)','execute')
    or has_function_privilege('authenticated','public.admin_sms_operation_v1(text,uuid,uuid,text,uuid,text,uuid,boolean,text)','execute') then
    raise exception 'Admin verification must be service-only';
  end if;
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role,created_at,updated_at)
    values(u,u::text||'@admin-sms-test.invalid',jsonb_build_object('role','calup_admin','admin_phone',phone),'{}','authenticated','authenticated',now(),now());
  insert into auth.sessions(id,user_id,aal,created_at,updated_at) values(s,u,'aal1',now(),now()),(s2,u,'aal1',now(),now());
  r := public.admin_sms_operation_v1('reserve_send',u,s,phone,c);
  if r->>'id'<>c::text then raise exception 'Send reservation failed'; end if;
  r := public.admin_sms_operation_v1('reserve_send',u,s2,phone,gen_random_uuid());
  if r->>'error'<>'COOLDOWN' then raise exception 'Cross-session send cooldown bypass'; end if;
  perform public.admin_sms_operation_v1('finish_send',u,s,phone,c,'encrypted-test');
  r := public.admin_sms_operation_v1('reserve_verify',u,s,phone,c,p_lease_id=>l);
  if r->>'ciphertext'<>'encrypted-test' then raise exception 'Missing private reference'; end if;
  r := public.admin_sms_operation_v1('reserve_verify',u,s,phone,c,p_lease_id=>gen_random_uuid());
  if r->>'error'<>'BUSY' then raise exception 'Concurrent verification bypass'; end if;
  stale:=l; l:=gen_random_uuid();
  update public.admin_sms_challenges set lease_until=now()-interval '1 second' where session_id=s;
  perform public.admin_sms_operation_v1('reserve_verify',u,s,phone,c,p_lease_id=>l);
  r := public.admin_sms_operation_v1('finish_verify',u,s,phone,c,p_lease_id=>stale,p_verified=>true,p_token_hash=>repeat('a',64));
  if r->>'error'<>'STALE' then raise exception 'Stale verifier completed'; end if;
  perform public.admin_sms_operation_v1('finish_verify',u,s,phone,c,p_lease_id=>l,p_verified=>true,p_token_hash=>repeat('a',64));
  if not public.verify_calup_admin_sms_session_v1(u,s,repeat('a',64)) then raise exception 'Verified grant rejected'; end if;
  if public.verify_calup_admin_sms_session_v1(u,s,repeat('b',64)) or public.verify_calup_admin_sms_session_v1(u,s2,repeat('a',64)) then raise exception 'Cookie/session binding bypass'; end if;
  r := public.admin_sms_operation_v1('reserve_verify',u,s,phone,c,p_lease_id=>gen_random_uuid());
  if r->>'error'<>'NO_CHALLENGE' then raise exception 'Consumed challenge replay'; end if;
  update public.admin_sms_grants set expires_at=now()-interval '1 second' where session_id=s;
  if public.verify_calup_admin_sms_session_v1(u,s,repeat('a',64)) then raise exception 'Expired grant accepted'; end if;
  update public.admin_sms_grants set expires_at=now()+interval '30 minutes' where session_id=s;
  update auth.users set raw_app_meta_data=raw_app_meta_data||'{"admin_phone":"+919000000002"}' where id=u;
  if public.verify_calup_admin_sms_session_v1(u,s,repeat('a',64)) then raise exception 'Changed phone accepted'; end if;
  update auth.users set raw_app_meta_data=jsonb_build_object('role','merchant','admin_phone',phone) where id=u;
  if public.verify_calup_admin_sms_session_v1(u,s,repeat('a',64)) then raise exception 'Revoked role accepted'; end if;
  update auth.users set raw_app_meta_data=jsonb_build_object('role','calup_admin','admin_phone',phone) where id=u;
  perform public.admin_sms_operation_v1('revoke',u,s,phone);
  if public.verify_calup_admin_sms_session_v1(u,s,repeat('a',64)) then raise exception 'Revoked grant accepted'; end if;

  update public.admin_sms_events set created_at=now()-interval '61 seconds' where user_id=u;
  c:=gen_random_uuid();
  perform public.admin_sms_operation_v1('reserve_send',u,s,phone,c);
  perform public.admin_sms_operation_v1('finish_send',u,s,phone,c,'encrypted-test');
  for i in 1..5 loop
    l:=gen_random_uuid();
    perform public.admin_sms_operation_v1('reserve_verify',u,s,phone,c,p_lease_id=>l);
    perform public.admin_sms_operation_v1('finish_verify',u,s,phone,c,p_lease_id=>l,p_verified=>false);
  end loop;
  r := public.admin_sms_operation_v1('reserve_verify',u,s,phone,c,p_lease_id=>gen_random_uuid());
  if r->>'error'<>'ATTEMPTS' then raise exception 'Guess limit bypass'; end if;
  update public.admin_sms_challenges set expires_at=now()-interval '1 second' where session_id=s;
  r := public.admin_sms_operation_v1('reserve_verify',u,s,phone,c,p_lease_id=>gen_random_uuid());
  if r->>'error'<>'EXPIRED' then raise exception 'Expired challenge accepted'; end if;
  update public.admin_sms_events set created_at=now()-interval '61 seconds' where user_id=u;
  insert into public.admin_sms_events(user_id,session_id,event,created_at)
    select u,s,'send_reserved',now()-interval '2 minutes' from generate_series(1,5);
  r := public.admin_sms_operation_v1('reserve_send',u,s2,phone,gen_random_uuid());
  if r->>'error'<>'SEND_LIMIT' then raise exception 'Hourly user limit bypass'; end if;
  insert into public.admin_sms_grants(session_id,user_id,phone,token_hash,expires_at) values(s,u,phone,repeat('c',64),now()+interval '30 minutes');
  delete from auth.sessions where id=s;
  if public.verify_calup_admin_sms_session_v1(u,s,repeat('c',64)) then raise exception 'Deleted session accepted'; end if;
end $$;
rollback;
