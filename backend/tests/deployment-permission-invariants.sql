begin;
do $$
begin
  assert public.get_deployment_release_readiness_v1()->>'ready'='true', 'Deployment prerequisites must be installed';
  assert not has_function_privilege('anon','public.get_deployment_release_readiness_v1()','EXECUTE');
  assert not has_function_privilege('authenticated','public.get_deployment_release_readiness_v1()','EXECUTE');
  execute 'grant select on public.coach_risk_metrics to anon';
  assert public.get_deployment_release_readiness_v1()->>'ready'='false', 'Gate must reject exposed administrative view';
  execute 'revoke all on public.coach_risk_metrics from anon';
  assert public.get_deployment_release_readiness_v1()->>'ready'='true';
  execute 'alter policy "Allow Avatar Uploads" on storage.objects to public';
  assert public.get_deployment_release_readiness_v1()->>'ready'='false', 'Gate must reject anonymous storage writes';
  execute 'alter policy "Allow Avatar Uploads" on storage.objects to authenticated';
  assert public.get_deployment_release_readiness_v1()->>'ready'='true';
end $$;
rollback;
