begin;
-- Additive repair for existing installations; do not rerun historical broad grants.
drop policy if exists "Service role can manage payment screenshots" on storage.objects;
create policy "Service role can manage payment screenshots" on storage.objects for all to service_role
using (bucket_id='payment-screenshots') with check (bucket_id='payment-screenshots');
update storage.buckets set public=false where id='payment-screenshots';
-- =============================================================================
-- Migration: Add avatar_url to providers and create public avatars storage bucket
-- =============================================================================

-- 1. Add avatar_url column to providers table
alter table public.providers
add column if not exists avatar_url text;

-- 2. Create public storage bucket for avatars if not exists
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880, -- 5MB limit
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

-- 3. Storage Policies: Allow public read access to avatars
drop policy if exists "Public Read Avatars" on storage.objects;
create policy "Public Read Avatars"
on storage.objects for select
using (bucket_id = 'avatars');

-- 4. Storage Policies: Allow authenticated users to upload avatars
drop policy if exists "Allow Avatar Uploads" on storage.objects;
create policy "Allow Avatar Uploads"
on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and exists (
  select 1 from public.providers p where p.user_id = (select auth.uid())
    and (storage.objects.name like p.id::text || '-%' or storage.objects.name like 'qr-' || p.id::text || '-%')
));

-- 5. Storage Policies: Allow avatar updates
drop policy if exists "Allow Avatar Updates" on storage.objects;
create policy "Allow Avatar Updates"
on storage.objects for update to authenticated
using (bucket_id = 'avatars' and exists (
  select 1 from public.providers p where p.user_id = (select auth.uid())
    and (storage.objects.name like p.id::text || '-%' or storage.objects.name like 'qr-' || p.id::text || '-%')
))
with check (bucket_id = 'avatars' and exists (
  select 1 from public.providers p where p.user_id = (select auth.uid())
    and (storage.objects.name like p.id::text || '-%' or storage.objects.name like 'qr-' || p.id::text || '-%')
));


alter view public.coach_risk_metrics set (security_invoker=true);
revoke all on public.coach_risk_metrics from public,anon,authenticated;
grant select on public.coach_risk_metrics to service_role;
alter function public.get_provider_busy_slots(uuid,date) set search_path=pg_catalog,public;
create or replace function public.get_deployment_release_readiness_v1()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare prior jsonb; ready boolean:=true; role_name text; relation_name text; policy_row record;
begin
 prior:=public.get_integration_release_readiness_v1();
 if prior->>'release'<>'20261025-integration-audit' or prior->>'ready'<>'true' then ready:=false; end if;
 if not exists(select 1 from pg_catalog.pg_class where oid='public.coach_risk_metrics'::regclass and reloptions @> array['security_invoker=true']) then ready:=false; end if;
 foreach role_name in array array['anon','authenticated'] loop
   foreach relation_name in array array['public.coach_risk_metrics','public.google_tokens','public.commerce_contacts','public.commerce_customer_sessions'] loop
     if pg_catalog.has_any_column_privilege(role_name,relation_name,'SELECT') then ready:=false; end if;
   end loop;
 end loop;
 if not exists(select 1 from pg_catalog.pg_policy where polrelid='storage.objects'::regclass
   and polname='Service role can manage payment screenshots'
   and polroles=array[(select oid from pg_catalog.pg_roles where rolname='service_role')]) then ready:=false; end if;
 foreach relation_name in array array['Allow Avatar Uploads','Allow Avatar Updates'] loop
   select * into policy_row from pg_catalog.pg_policy where polrelid='storage.objects'::regclass and polname=relation_name;
   if not found then ready:=false;
   elsif policy_row.polroles<>array[(select oid from pg_catalog.pg_roles where rolname='authenticated')]
     or pg_catalog.strpos(pg_catalog.pg_get_expr(policy_row.polwithcheck,policy_row.polrelid),'auth.uid()')=0
     or pg_catalog.strpos(pg_catalog.pg_get_expr(policy_row.polwithcheck,policy_row.polrelid),'p.id')=0
     or policy_row.polwithcheck is null then ready:=false; end if;
 end loop;
 if not exists(select 1 from storage.buckets where id='payment-screenshots' and not public) then ready:=false; end if;
 if not exists(select 1 from pg_catalog.pg_proc where oid='public.get_provider_busy_slots(uuid,date)'::regprocedure
   and proconfig @> array['search_path=pg_catalog, public']) then ready:=false; end if;
 return pg_catalog.jsonb_build_object('release','20261025-deployment-audit','ready',ready);
exception when others then return pg_catalog.jsonb_build_object('release','20261025-deployment-audit','ready',false);
end $$;
revoke all on function public.get_deployment_release_readiness_v1() from public,anon,authenticated;
grant execute on function public.get_deployment_release_readiness_v1() to service_role;
commit;
