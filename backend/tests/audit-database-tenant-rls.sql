begin;
select set_config('calup.audit.provider_a',:'provider_a',true),set_config('calup.audit.provider_b',:'provider_b',true);
select set_config('request.jwt.claim.sub',:'user_a',true),set_config('request.jwt.claims',json_build_object('sub',:'user_a','role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.bookings where customer_name='audit-rls-' || current_setting('calup.audit.provider_a'))<>1
    or exists(select 1 from public.bookings where provider_id=current_setting('calup.audit.provider_b')::uuid)
    or (select count(*) from public.customers where name='audit-rls-' || current_setting('calup.audit.provider_a'))<>1
    or exists(select 1 from public.customers where name='audit-rls-' || current_setting('calup.audit.provider_b')) then
    raise exception 'Tenant A booking/contact isolation failed';
  end if;
  update public.bookings set notes=notes where provider_id=current_setting('calup.audit.provider_b')::uuid;
  if found then raise exception 'Tenant A updated tenant B booking'; end if;
  update public.bookings set notes=notes where customer_name='audit-rls-' || current_setting('calup.audit.provider_a');
  if not found then raise exception 'Tenant A lost legitimate own-booking update access'; end if;
  begin
    insert into public.bookings(provider_id) values(current_setting('calup.audit.provider_a')::uuid);
    raise exception 'Direct booking insertion was allowed';
  exception when insufficient_privilege then null; end;
  begin
    update public.customers set name=name where false;
    raise exception 'Direct customer update was allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',:'user_b',true),set_config('request.jwt.claims',json_build_object('sub',:'user_b','role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.bookings where customer_name='audit-rls-' || current_setting('calup.audit.provider_b'))<>1
    or exists(select 1 from public.bookings where provider_id=current_setting('calup.audit.provider_a')::uuid)
    or (select count(*) from public.customers where name='audit-rls-' || current_setting('calup.audit.provider_b'))<>1
    or exists(select 1 from public.customers where name='audit-rls-' || current_setting('calup.audit.provider_a')) then
    raise exception 'Tenant B booking/contact isolation failed';
  end if;
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform count(*) from public.bookings;
    raise exception 'Anonymous booking read was allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform count(*) from public.customers;
    raise exception 'Anonymous contact read was allowed';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
