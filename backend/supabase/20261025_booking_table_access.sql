-- Booking creation and customer contact writes now use authorized backend RPCs.
-- Browser table INSERT must not bypass atomic occupancy or authoritative prices.
begin;
revoke insert on public.bookings from public, anon, authenticated;
revoke select, update, delete on public.bookings from public, anon;
drop policy if exists "Public can create a booking" on public.bookings;
grant select, update, delete on public.bookings to authenticated;
grant all on public.bookings to service_role;

-- Global customer contacts must not be publicly readable or browser writable.
revoke all on public.customers from public, anon, authenticated;
grant select on public.customers to authenticated;
grant all on public.customers to service_role;
drop policy if exists "Providers can view customers" on public.customers;
drop policy if exists "Public can view customers" on public.customers;
drop policy if exists "Providers can view own customers" on public.customers;
drop policy if exists "Anyone can insert customer record upon booking" on public.customers;
drop policy if exists "Anyone can update customer contact upon booking" on public.customers;
alter table public.customers enable row level security;
create policy "Providers can view own customers"
  on public.customers for select to authenticated
  using (id in (
    select b.customer_id from public.bookings b
    join public.providers p on p.id = b.provider_id
    where p.user_id = auth.uid()
  ));
commit;
