-- =============================================================================
-- Migration: Add Google OAuth Token Storage in Supabase
-- Stores AES-256-GCM encrypted Google OAuth tokens per provider so tokens
-- survive Render container redeployments and restarts.
-- =============================================================================

-- 1. Create dedicated google_tokens table
create table if not exists public.google_tokens (
  provider_id uuid primary key references public.providers(id) on delete cascade,
  email text,
  encrypted_access_token text not null,
  encrypted_refresh_token text,
  expires_at bigint not null,
  scope text,
  connected_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

comment on table public.google_tokens is
  'Multi-tenant Google OAuth token store. Tokens are encrypted at rest with AES-256-GCM using TOKEN_ENCRYPTION_KEY.';

-- 2. Index for fast token lookups by provider
create index if not exists idx_google_tokens_provider_id
  on public.google_tokens(provider_id);

-- 3. RLS: Secure google_tokens table
alter table public.google_tokens enable row level security;

-- Allow full access to service_role
drop policy if exists "Service role full access on google_tokens" on public.google_tokens;
create policy "Service role full access on google_tokens"
  on public.google_tokens
  for all
  using (true)
  with check (true);

-- Explicitly revoke access from anon and authenticated roles
revoke all on public.google_tokens from anon, authenticated;
grant all on public.google_tokens to service_role;

-- 4. Clean any tagged [gcal_tokens:...] out of providers.bio
update public.providers
set bio = trim(regexp_replace(bio, '\n?\[gcal_tokens:[^\]]+\]', '', 'g'))
where bio like '%[gcal_tokens:%';
