# Calup

Appointment booking with a React frontend, Express API, Supabase persistence, Google Calendar, and manual UPI payment verification.

## Repository Layout

```text
frontend/              React app and frontend configuration
  src/                 Pages, components, state, services, utilities, styles
  public/              Static assets
  index.html           Browser entry
  vite.config.js       Vite configuration
  vercel.json          Frontend deployment configuration
backend/
  server/              Express routes, middleware, integrations, utilities
  supabase/            Schema, migrations, database fixtures
  tests/               Node unit/integration/regression suites
  render.yaml          Backend deployment blueprint
guides/                Reference documents and central HTML reader
package.json           Shared dependencies and repository commands
.env.example           Shared local environment template
```

Run commands from the repository root. Dependencies and the lockfile are shared; there is one installation for both applications. Local `node_modules/` and `.venv/` are ignored tooling environments, not source folders.

## College deployment and retained test hosts

The college repository deploys `main` through its existing `gamma` runner to `https://calup.app`. Docker builds the current frontend/backend layout and Nginx routes same-origin API traffic. Vercel and Render remain configured for testing; the Vercel workflow runs only in the original source repository.

Deployment notes live locally at `guides/project/college-deployment.md`; the guides directory is intentionally excluded from Git and Docker. `npm run lint:ci` and `npm run test:isolated` work without that local documentation/tooling. The full `npm test` additionally needs an isolated integration database/API.

The October 25 audit requires the five `backend/supabase/20261025_*.sql` migrations after the existing schema/migrations. Use [the disposable database runner](backend/scripts/verify-audit-database.mjs) to test them against an empty Supabase test database with the existing schema. The runner uses the matching `backend/tests/*-invariants.sql` and `pending-booking-expiry-scenarios.sql`; verify concurrent reservations and tenant isolation there. Apply reviewed migrations to the deployment database before promoting the application. Deployment performs a read-only schema/privilege readiness check and leaves the running containers untouched if it fails. It never applies SQL automatically. These changes remove browser booking insertion and email-based ownership reassignment; legacy account relinking requires a trusted migration.

## Disposable database checks

Install psql and restore the existing base schema/historical migrations into a disposable Supabase project with no users, providers, bookings or customer contacts. The runner refuses nonempty databases. Then run from this repository root in PowerShell:

```powershell
$env:CALUP_AUDIT_DISPOSABLE_DB = 'true'
$env:AUDIT_DATABASE_URL = '<disposable PostgreSQL connection URI>'
npm run test:database:audit -- --apply-audit
```

This optionally applies only the five audit migrations, checks grants and tenant isolation, and runs competing booking/expiry/reschedule transactions. Fixtures are removed afterward; discard the test database if interrupted. Omit --apply-audit to check an already migrated empty test database. This command has not been executed against PostgreSQL here and is never a production migration command. Full local instructions remain in ignored guides/project/disposable-database-checks.md.

## Local Development

1. Install dependencies with `npm install` using Node.js 22.12+ (required by the current Vite toolchain).
2. Copy `.env.example` to `.env` and supply your configuration. Vite and Express both read this root file; only `VITE_` variables are exposed to the browser.
3. Run `npm run dev` for Vite at `http://localhost:5173` and Express at `http://localhost:3001`. Use `npm run client` or `npm run server` to start either independently.

- `npm run build`: writes the production frontend to `frontend/dist/`.
- `npm run preview`: previews that build with the configured API proxy.
- `npm run lint:ci`: checks tracked frontend/backend and repository tooling.
- `npm run lint`: additionally checks local guide tooling, when present.
- `npm test`: runs registered suites; integration suites require an isolated configured database/API.
- `npm run guides` / `npm run guides:check`: local documentation tools; require the ignored guides directory.

Local reference documents remain under `guides/` and are not included in fresh Git checkouts. Payment submission requires provider verification; refund records track manual settlement.
