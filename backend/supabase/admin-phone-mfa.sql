-- Native Supabase MFA owns challenges, OTPs and session assurance.
-- Read only the approved active session; never expose auth schema rows.
create or replace function public.verify_calup_admin_session_v1(p_user_id uuid, p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
    join auth.sessions s on s.user_id = u.id
    join auth.mfa_factors f on f.id = s.factor_id and f.user_id = u.id
    where u.id = p_user_id and s.id = p_session_id
      and u.raw_app_meta_data->>'role' = 'calup_admin'
      and u.raw_app_meta_data->>'admin_phone' ~ '^\+[1-9][0-9]{7,14}$'
      and f.phone = u.raw_app_meta_data->>'admin_phone'
      and f.factor_type = 'phone' and f.status = 'verified' and s.aal = 'aal2'
      and (s.not_after is null or s.not_after > now())
      and (u.banned_until is null or u.banned_until <= now())
  );
$$;
revoke all on function public.verify_calup_admin_session_v1(uuid, uuid) from public, anon, authenticated;
grant execute on function public.verify_calup_admin_session_v1(uuid, uuid) to service_role;
