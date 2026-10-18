-- Recover the current checkout after the URL stopped carrying an attempt UUID.

create or replace function public.find_booking_attempt_by_token_v1(p_attempt_token_hash text)
returns uuid
language sql stable security definer
set search_path = pg_catalog, app
as $$
  select id
  from app.booking_attempts
  where attempt_token_hash = p_attempt_token_hash
  order by created_at desc
  limit 1;
$$;

revoke all on function public.find_booking_attempt_by_token_v1(text) from public, anon, authenticated;
grant execute on function public.find_booking_attempt_by_token_v1(text) to service_role;

