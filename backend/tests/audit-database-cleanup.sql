begin;
delete from public.bookings where provider_id in (:'provider_a'::uuid,:'provider_b'::uuid);
delete from public.services where provider_id in (:'provider_a'::uuid,:'provider_b'::uuid);
delete from public.instructors where provider_id in (:'provider_a'::uuid,:'provider_b'::uuid);
delete from app.merchant_entitlements where provider_id in (:'provider_a'::uuid,:'provider_b'::uuid);
delete from public.providers where id in (:'provider_a'::uuid,:'provider_b'::uuid);
delete from auth.users where id in (:'user_a'::uuid,:'user_b'::uuid);
delete from public.customers where name like 'audit-%' and (name like '%' || :'provider_a' or name like '%' || :'provider_b');
commit;
