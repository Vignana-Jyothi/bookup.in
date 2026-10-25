# College environment writer

[Source](../../../backend/scripts/college-env.mjs). `publicNames`/private allowlists define application inputs; arbitrary workflow tokens are ignored. `httpsUrl` validates URL shape without reporting values. `prepareCollegeEnvironment` merges nonempty secrets over variables, normalizes defaults, fixes same-origin API routing, validates matching Supabase projects/public keys/encryption/booleans and conditional integration credentials, and returns separate public/backend maps.

`fixtureSettings` contains fake CI credentials only. `writeCollegeEnvironment` writes temporary private files and renames them to managed root `.env` (public Compose single-quoted values) and `.env.backend` (literal raw runtime values). Validated single-line values cannot inject new environment entries. Errors identify names; malformed JSON errors are sanitized.

College URL validation requires VITE_APP_URL, FRONTEND_URL and BACKEND_PUBLIC_URL to resolve to the exact https://calup.app origin; it normalizes a trailing slash and rejects stale testing-host secrets. GOOGLE_REDIRECT_URI defaults to https://calup.app/api/auth/google/callback and must match that exact URL if supplied. This writer is college-specific; shared application configuration and Vercel/Render workflows remain configurable for their own domains. Provider dashboard allowlists are separate; see [the integration URL table](../../project/college-deployment.md#public-integration-urls).

CLI takes CALUP_DEPLOY_SECRETS and optional CALUP_DEPLOY_VARIABLES JSON or explicit `--fixture`. Fixture mode refuses existing environment files; production mode replaces managed files only after validation. No database/network calls or existing `.env` imports. See [runbook](../../project/college-deployment.md) and [regression](../tests/test-college-deployment.js.md).

