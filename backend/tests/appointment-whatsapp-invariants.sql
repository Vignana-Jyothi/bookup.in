begin;
do $$
declare v_job uuid; v_expired uuid; v_leased uuid; v_retry uuid; result jsonb;
begin
  insert into public.appointment_whatsapp_jobs(appointment_id,status,lease_owner,lease_generation,lease_expires_at)
    values(gen_random_uuid(),'sending','worker-a',2,now()+interval '1 minute') returning id into v_job;
  insert into public.appointment_whatsapp_attempts(job_id,generation,status) values(v_job,2,'sending');
  assert not public.complete_appointment_whatsapp_v1(v_job,'worker-b',2,'submitted','wamid.test',null);
  assert not public.complete_appointment_whatsapp_v1(v_job,'worker-a',1,'submitted','wamid.test',null);
  assert public.complete_appointment_whatsapp_v1(v_job,'worker-a',2,'submitted','wamid.test',null);
  assert not public.complete_appointment_whatsapp_v1(v_job,'worker-a',2,'failed',null,'stale');
  assert (select status='submitted' from public.appointment_whatsapp_jobs where id=v_job);
  insert into public.appointment_whatsapp_jobs(appointment_id,status,lease_owner,lease_generation,lease_expires_at)
    values(gen_random_uuid(),'sending','worker-a',1,now()-interval '1 second') returning id into v_expired;
  insert into public.appointment_whatsapp_attempts(job_id,generation,status) values(v_expired,1,'sending');
  insert into public.appointment_whatsapp_jobs(appointment_id,status,lease_owner,lease_generation,lease_expires_at)
    values(gen_random_uuid(),'leased','worker-a',1,now()-interval '1 second') returning id into v_leased;
  result:=public.claim_appointment_whatsapp_v1('worker-b',25);
  assert (select status='review_required' from public.appointment_whatsapp_jobs where id=v_expired);
  assert (select status='review_required' from public.appointment_whatsapp_attempts where job_id=v_expired);
  assert (select status='leased' and lease_owner='worker-b' and lease_generation=2 from public.appointment_whatsapp_jobs where id=v_leased);
  assert public.begin_appointment_whatsapp_v1(v_leased,'worker-a',1) is null;
  assert public.begin_appointment_whatsapp_v1(v_leased,'worker-b',2) is null;
  assert (select status='cancelled' from public.appointment_whatsapp_jobs where id=v_leased);
  insert into public.appointment_whatsapp_jobs(appointment_id,status,lease_owner,lease_generation,lease_expires_at,attempt_count)
    values(gen_random_uuid(),'sending','worker-a',5,now()+interval '1 minute',5) returning id into v_retry;
  insert into public.appointment_whatsapp_attempts(job_id,generation,status) values(v_retry,5,'sending');
  assert public.complete_appointment_whatsapp_v1(v_retry,'worker-a',5,'retry_wait',null,'meta_rate_limited');
  assert (select status='failed' from public.appointment_whatsapp_jobs where id=v_retry);
  assert not has_table_privilege('anon','public.appointment_whatsapp_jobs','SELECT');
  assert not has_function_privilege('authenticated','public.claim_appointment_whatsapp_v1(text,integer)','EXECUTE');
end;
$$;
rollback;
