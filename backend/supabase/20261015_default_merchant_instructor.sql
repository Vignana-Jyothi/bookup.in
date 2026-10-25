-- Ensure every merchant is the default instructor and legacy service writes inherit it.

insert into public.instructors(provider_id, name, active, is_owner)
select p.id, coalesce(nullif(trim(p.name), ''), 'Merchant'), true, true
from public.providers p
where not exists (
  select 1 from public.instructors i where i.provider_id = p.id and i.is_owner
);

insert into public.instructor_availability(instructor_id, day_of_week, start_time, end_time, active)
select i.id, d.day_name,
  case when a.start_time is not null and a.end_time is not null and a.start_time::time < a.end_time::time
    then a.start_time::time else '09:00'::time end,
  case when a.start_time is not null and a.end_time is not null and a.start_time::time < a.end_time::time
    then a.end_time::time else '18:00'::time end,
  coalesce(a.active, d.day_name <> 'sunday')
from public.instructors i
cross join (values ('monday'),('tuesday'),('wednesday'),('thursday'),('friday'),('saturday'),('sunday')) d(day_name)
left join public.availability a
  on a.provider_id = i.provider_id and lower(a.day_of_week) = d.day_name
where i.is_owner
on conflict (instructor_id, day_of_week) do nothing;

create or replace function public.sync_provider_owner_instructor_v1()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_instructor_id uuid;
begin
  select id into v_instructor_id
  from public.instructors
  where provider_id = new.id and is_owner;

  if v_instructor_id is null then
    insert into public.instructors(provider_id, name, active, is_owner)
    values (new.id, coalesce(nullif(trim(new.name), ''), 'Merchant'), true, true)
    returning id into v_instructor_id;
  else
    update public.instructors
    set name = coalesce(nullif(trim(new.name), ''), 'Merchant'), active = true, updated_at = now()
    where id = v_instructor_id;
  end if;

  insert into public.instructor_availability(instructor_id, day_of_week, start_time, end_time, active)
  select v_instructor_id, d.day_name,
    case when a.start_time is not null and a.end_time is not null and a.start_time::time < a.end_time::time
      then a.start_time::time else '09:00'::time end,
    case when a.start_time is not null and a.end_time is not null and a.start_time::time < a.end_time::time
      then a.end_time::time else '18:00'::time end,
    coalesce(a.active, d.day_name <> 'sunday')
  from (values ('monday'),('tuesday'),('wednesday'),('thursday'),('friday'),('saturday'),('sunday')) d(day_name)
  left join public.availability a
    on a.provider_id = new.id and lower(a.day_of_week) = d.day_name
  on conflict (instructor_id, day_of_week) do nothing;

  return new;
end;
$$;

drop trigger if exists providers_sync_owner_instructor_v1 on public.providers;
create trigger providers_sync_owner_instructor_v1
after insert or update of name on public.providers
for each row execute function public.sync_provider_owner_instructor_v1();

create or replace function public.assign_default_service_instructor_v1()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if new.instructor_id is null then
    select id into new.instructor_id
    from public.instructors
    where provider_id = new.provider_id and is_owner and active;
  end if;

  if new.instructor_id is null then
    raise exception 'DEFAULT_INSTRUCTOR_NOT_FOUND';
  end if;

  if new.available_weekdays is null or cardinality(new.available_weekdays) = 0 then
    select array_agg(day_of_week order by case day_of_week
      when 'monday' then 1 when 'tuesday' then 2 when 'wednesday' then 3
      when 'thursday' then 4 when 'friday' then 5 when 'saturday' then 6 else 7 end)
    into new.available_weekdays
    from public.instructor_availability
    where instructor_id = new.instructor_id and active;
  end if;

  return new;
end;
$$;

drop trigger if exists services_assign_default_instructor_v1 on public.services;
create trigger services_assign_default_instructor_v1
before insert or update on public.services
for each row execute function public.assign_default_service_instructor_v1();

revoke all on function public.sync_provider_owner_instructor_v1() from public, anon, authenticated;
revoke all on function public.assign_default_service_instructor_v1() from public, anon, authenticated;
