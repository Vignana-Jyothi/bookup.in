-- Read-only effective privileges; run only in an isolated fully migrated DB.
do $$
declare role_name text; privilege_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    if has_table_privilege(role_name,'public.bookings','INSERT') then
      raise exception 'Direct booking INSERT remains for %', role_name;
    end if;
    foreach privilege_name in array array['INSERT','UPDATE','DELETE'] loop
      if has_table_privilege(role_name,'public.customers',privilege_name) then
        raise exception 'Direct customer write % remains for %', privilege_name, role_name;
      end if;
    end loop;
  end loop;
  if has_table_privilege('anon','public.bookings','SELECT')
    or has_table_privilege('anon','public.customers','SELECT') then
    raise exception 'Anonymous booking/contact access remains';
  end if;
  if not has_table_privilege('service_role','public.bookings','INSERT')
    or not has_table_privilege('service_role','public.customers','INSERT') then
    raise exception 'Backend creation privilege missing';
  end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='customers' and c.relrowsecurity) then
    raise exception 'Customer RLS must remain enabled';
  end if;
end $$;
