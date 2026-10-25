-- ==============================================================================
-- BookUp — Phase 4: WhatsApp Notifications Migration
-- Adds tracking columns for RichAutomate message delivery,
-- encrypted management tokens for server-side offline reminder generation,
-- and indexes for efficient 2-hour reminder batch processing.
-- ==============================================================================

-- 1. Add notification tracking columns and encrypted management token to public.bookings
alter table public.bookings
  add column if not exists management_token_encrypted text default null,
  add column if not exists customer_confirmation_sent_at timestamptz default null,
  add column if not exists customer_confirmation_msg_id text default null,
  add column if not exists customer_confirmation_error text default null,
  add column if not exists provider_notification_sent_at timestamptz default null,
  add column if not exists provider_notification_msg_id text default null,
  add column if not exists provider_notification_error text default null,
  add column if not exists reminder_sent_at timestamptz default null,
  add column if not exists reminder_msg_id text default null,
  add column if not exists reminder_error text default null;

-- 2. Index for reminder worker to efficiently query upcoming confirmed appointments
create index if not exists idx_bookings_reminder_lookup
  on public.bookings (booking_date, start_time, status)
  where reminder_sent_at is null and status = 'confirmed';

-- 3. Comments for documentation and schema introspection
comment on column public.bookings.management_token_encrypted is
  'AES-256-GCM encrypted customer management token bundle (iv:authTag:ciphertext). Never stored in plaintext. Decrypted only on server when dispatching offline 2-hour reminder.';

comment on column public.bookings.customer_confirmation_sent_at is
  'Timestamp when WhatsApp booking confirmation was dispatched to the customer via RichAutomate.';

comment on column public.bookings.provider_notification_sent_at is
  'Timestamp when WhatsApp new-booking notification was dispatched to the provider via RichAutomate.';

comment on column public.bookings.reminder_sent_at is
  'Timestamp when WhatsApp 2-hour reminder was dispatched to the customer via RichAutomate.';

-- Reminder scheduling is owned by the backend worker; no database cron is installed.
