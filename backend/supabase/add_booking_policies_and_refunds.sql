-- =============================================================================
-- CalUp — Booking Policies, Refund Ledger, Audit Logs & Safeguards Migration
-- =============================================================================

create extension if not exists "uuid-ossp";

-- =============================================================================
-- 1. CANCELLATION POLICIES TABLE: Add Granular Policy Rule Columns
-- =============================================================================
alter table public.cancellation_policies
  add column if not exists full_refund_hours integer not null default 24,
  add column if not exists partial_refund_hours integer not null default 2,
  add column if not exists partial_refund_percent integer not null default 50,
  add column if not exists no_show_grace_minutes integer not null default 15,
  add column if not exists max_reschedules integer not null default 2,
  add column if not exists reschedule_min_hours_before integer not null default 24,
  add column if not exists payment_verification_timeout_hours integer not null default 24;

alter table public.cancellation_policies
  drop constraint if exists chk_policy_hours_valid,
  drop constraint if exists chk_policy_percent_valid,
  drop constraint if exists chk_policy_grace_valid;

alter table public.cancellation_policies
  add constraint chk_policy_hours_valid 
    check (full_refund_hours >= partial_refund_hours and partial_refund_hours >= 0 and reschedule_min_hours_before >= 0 and payment_verification_timeout_hours > 0),
  add constraint chk_policy_percent_valid 
    check (partial_refund_percent >= 0 and partial_refund_percent <= 100),
  add constraint chk_policy_grace_valid 
    check (no_show_grace_minutes >= 0 and max_reschedules >= 0);

-- =============================================================================
-- 2. BOOKINGS TABLE: Policy Snapshots, Acceptance, Reschedule, Refund & Dispute Columns
-- =============================================================================
alter table public.bookings
  add column if not exists policy_snapshot jsonb default null,
  add column if not exists policy_accepted_at timestamptz default null,
  add column if not exists reschedule_count integer not null default 0,
  add column if not exists refund_amount integer not null default 0,
  add column if not exists refund_reason text default null,
  add column if not exists refund_status text not null default 'none',
  add column if not exists coach_cancelled_at timestamptz default null,
  add column if not exists customer_no_show_at timestamptz default null,
  add column if not exists coach_no_show_reported_at timestamptz default null,
  add column if not exists disputed_at timestamptz default null,
  add column if not exists dispute_reason text default null;

create index if not exists idx_bookings_refund_status on public.bookings(provider_id, refund_status);
create index if not exists idx_bookings_disputed_at on public.bookings(provider_id, disputed_at);

-- =============================================================================
-- 3. REFUNDS TABLE (Refund Ledger)
-- =============================================================================
create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete cascade not null,
  provider_id uuid references public.providers(id) on delete cascade not null,
  amount integer not null check (amount >= 0),
  reason text not null,
  status text not null default 'refund_due' check (status in ('refund_due', 'refunded', 'confirmed', 'disputed')),
  created_at timestamptz default now() not null,
  refunded_at timestamptz default null,
  proof_url text default null,
  customer_confirmed_at timestamptz default null,
  dispute_note text default null,
  disputed_at timestamptz default null,
  updated_at timestamptz default now() not null,
  unique (booking_id)
);

create index if not exists idx_refunds_provider_status on public.refunds(provider_id, status);
create index if not exists idx_refunds_booking_id on public.refunds(booking_id);

-- =============================================================================
-- 4. AUDIT LOGS TABLE (State Change Safeguards)
-- =============================================================================
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete set null,
  provider_id uuid references public.providers(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  actor_type text not null check (actor_type in ('customer', 'coach', 'system', 'admin')),
  actor_id text default null,
  old_state jsonb default null,
  new_state jsonb default null,
  details text default null,
  created_at timestamptz default now() not null
);

create index if not exists idx_audit_logs_booking_id on public.audit_logs(booking_id);
create index if not exists idx_audit_logs_provider_id on public.audit_logs(provider_id);
create index if not exists idx_audit_logs_created_at on public.audit_logs(created_at desc);

-- =============================================================================
-- 5. ADMIN RISK VIEW (Coaches with repeated cancellations, no-shows, overdue refunds)
-- =============================================================================
create or replace view public.coach_risk_metrics as
select
  p.id as provider_id,
  p.name as provider_name,
  p.email as provider_email,
  count(b.id) filter (where b.status = 'cancelled' and b.refund_reason = 'coach_cancelled') as coach_cancellations_count,
  count(b.id) filter (where b.coach_no_show_reported_at is not null) as coach_no_shows_count,
  count(r.id) filter (where r.status = 'refund_due' and r.created_at < now() - interval '3 days') as overdue_refunds_count,
  count(r.id) filter (where r.status = 'disputed' or b.status = 'disputed') as active_disputes_count,
  coalesce(sum(r.amount) filter (where r.status = 'refund_due'), 0) as total_refund_due_amount
from public.providers p
left join public.bookings b on b.provider_id = p.id
left join public.refunds r on r.provider_id = p.id
group by p.id, p.name, p.email;

-- =============================================================================
-- 6. STORAGE BUCKET: Private Bucket for Refund Proofs
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'refund-proofs',
  'refund-proofs',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

-- =============================================================================
-- 7. ROW LEVEL SECURITY (RLS)
-- =============================================================================
alter table public.refunds enable row level security;
alter table public.audit_logs enable row level security;

create policy "Providers can view own refunds"
  on public.refunds for select
  using (provider_id in (select id from public.providers where user_id = auth.uid()));

create policy "Providers can update own refunds"
  on public.refunds for update
  using (provider_id in (select id from public.providers where user_id = auth.uid()));

create policy "Providers can view own audit logs"
  on public.audit_logs for select
  using (provider_id in (select id from public.providers where user_id = auth.uid()));
