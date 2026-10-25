begin;
insert into auth.users(id,email,aud,role) values
  (:'user_a'::uuid,:'user_a' || '@audit.invalid','authenticated','authenticated'),
  (:'user_b'::uuid,:'user_b' || '@audit.invalid','authenticated','authenticated');
insert into public.providers(id,user_id,name,slug,email,timezone,buffer_time,min_notice,max_advance_booking) values
  (:'provider_a'::uuid,:'user_a'::uuid,'Disposable audit A','audit-' || :'provider_a',:'user_a' || '@audit.invalid','UTC',0,0,30),
  (:'provider_b'::uuid,:'user_b'::uuid,'Disposable audit B','audit-' || :'provider_b',:'user_b' || '@audit.invalid','UTC',0,0,30);
insert into app.merchant_entitlements(provider_id,status,source,starts_at,expires_at,grace_ends_at) values
  (:'provider_a'::uuid,'active','migration',now()-interval '1 day',now()+interval '30 days',now()+interval '35 days'),
  (:'provider_b'::uuid,'active','migration',now()-interval '1 day',now()+interval '30 days',now()+interval '35 days');
insert into public.instructors(id,provider_id,name,active,is_owner,buffer_time,min_notice,max_advance_booking) values
  (:'instructor_a'::uuid,:'provider_a'::uuid,'Audit instructor A',true,false,0,0,30),
  (:'instructor_b'::uuid,:'provider_b'::uuid,'Audit instructor B',true,false,0,0,30);
insert into public.availability(provider_id,day_of_week,start_time,end_time,active)
select p,day,'09:00','18:00',true from (values (:'provider_a'::uuid),(:'provider_b'::uuid)) providers(p)
cross join unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) day;
insert into public.instructor_availability(instructor_id,day_of_week,start_time,end_time,active)
select i,day,'09:00'::time,'18:00'::time,true from (values (:'instructor_a'::uuid),(:'instructor_b'::uuid)) instructors(i)
cross join unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) day;
insert into public.services(id,provider_id,instructor_id,name,duration,price,active,available_weekdays) values
  (:'service_a'::uuid,:'provider_a'::uuid,:'instructor_a'::uuid,'Audit paid A',60,10,true,array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']),
  (:'service_b'::uuid,:'provider_b'::uuid,:'instructor_b'::uuid,'Audit paid B',60,10,true,array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']);
select public.create_booking_atomic(:'provider_a'::uuid,:'service_a'::uuid,'audit-rls-' || :'provider_a','',:'phone_a',:'phone_a',:'booking_date'::date,'09:00');
select public.create_booking_atomic(:'provider_b'::uuid,:'service_b'::uuid,'audit-rls-' || :'provider_b','',:'phone_b',:'phone_b',:'booking_date'::date,'09:00');
select public.create_booking_atomic(:'provider_a'::uuid,:'service_a'::uuid,'audit-expired-' || :'provider_a','',:'phone_expired',:'phone_expired',:'booking_date'::date,'13:00');
update public.bookings set created_at=clock_timestamp()-interval '31 minutes'
where provider_id=:'provider_a'::uuid and customer_name='audit-expired-' || :'provider_a';
commit;
