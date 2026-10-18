-- Give legacy/manual-payment bookings the same public M######### reference format.

alter table public.bookings add column if not exists booking_reference text;

create or replace function public.generate_booking_reference_v1()
returns text
language plpgsql volatile security definer
set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_bytes bytea;
  v_number bigint;
  v_reference text;
begin
  perform pg_advisory_xact_lock(hashtextextended('calup.booking_reference_v1', 0));
  loop
    v_bytes := extensions.gen_random_bytes(4);
    v_number := 100000000 + mod(
      get_byte(v_bytes, 0)::bigint * 16777216 +
      get_byte(v_bytes, 1)::bigint * 65536 +
      get_byte(v_bytes, 2)::bigint * 256 +
      get_byte(v_bytes, 3)::bigint,
      900000000
    );
    v_reference := 'M' || v_number::text;
    exit when not exists (select 1 from public.bookings where booking_reference = v_reference)
      and not exists (select 1 from app.appointments where booking_reference = v_reference);
  end loop;
  return v_reference;
end;
$$;

do $$
declare v_id uuid;
begin
  for v_id in select id from public.bookings where booking_reference is null order by created_at, id
  loop
    update public.bookings set booking_reference = public.generate_booking_reference_v1() where id = v_id;
  end loop;
end;
$$;

alter table public.bookings
  alter column booking_reference set default public.generate_booking_reference_v1(),
  alter column booking_reference set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_booking_reference_format_v1') then
    alter table public.bookings add constraint bookings_booking_reference_format_v1
      check (booking_reference ~ '^M[0-9]{9}$');
  end if;
end;
$$;

create unique index if not exists bookings_booking_reference_unique_v1
  on public.bookings(booking_reference);

revoke all on function public.generate_booking_reference_v1() from public, anon, authenticated;
grant execute on function public.generate_booking_reference_v1() to service_role;

comment on column public.bookings.booking_reference is
  'Public M plus nine digits booking identifier. The UUID primary key remains internal.';

create or replace function public.prevent_legacy_booking_reference_change_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.booking_reference is distinct from old.booking_reference then
    raise exception 'BOOKING_REFERENCE_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_booking_reference_immutable_v1 on public.bookings;
create trigger bookings_booking_reference_immutable_v1
before update of booking_reference on public.bookings
for each row execute function public.prevent_legacy_booking_reference_change_v1();

revoke all on function public.prevent_legacy_booking_reference_change_v1() from public, anon, authenticated;

