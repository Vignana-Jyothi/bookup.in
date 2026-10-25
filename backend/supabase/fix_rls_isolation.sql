-- =============================================================================
-- BookUp — Fix Provider Data Isolation (RLS Hardening)
-- Enforces strict database-level row isolation so authenticated coaches CANNOT
-- read another coach's bookings, customer list, QR code URL, UPI ID, or availability.
-- =============================================================================

-- 1. PROVIDERS TABLE RLS
-- Drop permissive public policy
drop policy if exists "Public can view providers" on public.providers;
drop policy if exists "Providers can view own record" on public.providers;
drop policy if exists "Anon can view providers" on public.providers;

-- Authenticated coaches can ONLY read their own provider profile
-- (Blocks cross-account reading of upi_id, qr_code_url, email, phone, etc.)
create policy "Providers can view own record"
  on public.providers for select
  to authenticated
  using (auth.uid() = user_id);

-- Anonymous visitors (customers on public booking page) can view provider info
create policy "Anon can view providers"
  on public.providers for select
  to anon
  using (true);


-- 2. CUSTOMERS TABLE RLS
-- Drop permissive public policy
drop policy if exists "Providers can view customers" on public.customers;
drop policy if exists "Public can view customers" on public.customers;
drop policy if exists "Providers can view own customers" on public.customers;

-- Authenticated coaches can ONLY read customers who have bookings with that coach
create policy "Providers can view own customers"
  on public.customers for select
  to authenticated
  using (
    id in (
      select customer_id from public.bookings
      where provider_id in (select id from public.providers where user_id = auth.uid())
    )
  );


-- 3. AVAILABILITY TABLE RLS
-- Drop permissive public policy
drop policy if exists "Public can view availability" on public.availability;
drop policy if exists "Providers can view own availability" on public.availability;
drop policy if exists "Anon can view availability" on public.availability;

-- Authenticated coaches can ONLY read their own availability schedule
create policy "Providers can view own availability"
  on public.availability for select
  to authenticated
  using (provider_id in (select id from public.providers where user_id = auth.uid()));

-- Anonymous visitors can view availability for booking slots
create policy "Anon can view availability"
  on public.availability for select
  to anon
  using (true);


-- 4. CANCELLATION POLICIES RLS
drop policy if exists "Public can view cancellation policies" on public.cancellation_policies;
drop policy if exists "Providers can view own cancellation policy" on public.cancellation_policies;
drop policy if exists "Anon can view cancellation policies" on public.cancellation_policies;

create policy "Providers can view own cancellation policy"
  on public.cancellation_policies for select
  to authenticated
  using (provider_id in (select id from public.providers where user_id = auth.uid()));

create policy "Anon can view cancellation policies"
  on public.cancellation_policies for select
  to anon
  using (true);


-- 5. BOOKINGS TABLE RLS (Ensure strict enforcement)
drop policy if exists "Providers can view own bookings" on public.bookings;
create policy "Providers can view own bookings"
  on public.bookings for select
  to authenticated
  using (provider_id in (select id from public.providers where user_id = auth.uid()));
