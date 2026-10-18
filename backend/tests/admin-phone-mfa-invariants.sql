begin;
do $$
declare
  u uuid := gen_random_uuid();
  s uuid := gen_random_uuid();
  f uuid := gen_random_uuid();
begin
  if has_function_privilege('authenticated', 'public.verify_calup_admin_session_v1(uuid,uuid)', 'execute')
    or has_function_privilege('anon', 'public.verify_calup_admin_session_v1(uuid,uuid)', 'execute') then
    raise exception 'Admin verification must be service-only';
  end if;
  insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at)
  values (u, u::text || '@admin-mfa-test.invalid', '{"role":"calup_admin","admin_phone":"+919000000001"}', '{}', 'authenticated', 'authenticated', now(), now());
  insert into auth.mfa_factors (id, user_id, factor_type, status, phone, created_at, updated_at)
  values (f, u, 'phone', 'verified', '+919000000001', now(), now());
  insert into auth.sessions (id, user_id, factor_id, aal, created_at, updated_at)
  values (s, u, f, 'aal2', now(), now());
  if not public.verify_calup_admin_session_v1(u,s) then raise exception 'Approved phone session rejected'; end if;
  update auth.sessions set not_after = now() - interval '1 second' where id=s;
  if public.verify_calup_admin_session_v1(u,s) then raise exception 'Expired session accepted'; end if;
  update auth.sessions set not_after = null where id=s;
  update auth.users set raw_app_meta_data = raw_app_meta_data || '{"admin_phone":"+919000000002"}' where id=u;
  if public.verify_calup_admin_session_v1(u,s) then raise exception 'Unapproved phone accepted'; end if;
  update auth.users set raw_app_meta_data = '{"role":"merchant","admin_phone":"+919000000001"}' where id=u;
  if public.verify_calup_admin_session_v1(u,s) then raise exception 'Revoked role accepted'; end if;
  update auth.users set raw_app_meta_data = '{"role":"calup_admin","admin_phone":"+919000000001"}' where id=u;
  delete from auth.sessions where id=s;
  if public.verify_calup_admin_session_v1(u,s) then raise exception 'Revoked session accepted'; end if;
end $$;
rollback;
