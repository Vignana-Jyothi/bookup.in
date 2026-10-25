-- Read-only; requires all audit migrations in an isolated database.
do $$
declare result jsonb;
begin
  if has_function_privilege('anon','public.get_integration_release_readiness_v1()','EXECUTE')
    or has_function_privilege('authenticated','public.get_integration_release_readiness_v1()','EXECUTE')
    or not has_function_privilege('service_role','public.get_integration_release_readiness_v1()','EXECUTE') then
    raise exception 'Integration release readiness must remain service-only';
  end if;
  result := public.get_integration_release_readiness_v1();
  if result is distinct from '{"release":"20261025-integration-audit","ready":true}'::jsonb then
    raise exception 'Integration gateway context release prerequisites are not ready';
  end if;
end $$;
