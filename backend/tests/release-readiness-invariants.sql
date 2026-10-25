-- Read-only; run in an isolated fully migrated database before deployment.
do $$
declare result jsonb;
begin
  if has_function_privilege('anon','public.get_release_readiness_v1()','EXECUTE')
    or has_function_privilege('authenticated','public.get_release_readiness_v1()','EXECUTE')
    or not has_function_privilege('service_role','public.get_release_readiness_v1()','EXECUTE') then
    raise exception 'Release readiness must be service-role-only';
  end if;
  result := public.get_release_readiness_v1();
  if result is distinct from '{"release":"20261025-code-audit","ready":true}'::jsonb then
    raise exception 'Database release prerequisites are not ready';
  end if;
end $$;
