# BookUp

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

## Local Development

1. Install dependencies with `npm install` using Node.js 22.12+ (required by the current Vite toolchain).
2. Copy `.env.example` to `.env` and supply your configuration. Vite and Express both read this root file; only `VITE_` variables are exposed to the browser.
3. Run `npm run dev` for Vite at `http://localhost:5173` and Express at `http://localhost:3001`. Use `npm run client` or `npm run server` to start either independently.

- `npm run build`: writes the production frontend to `frontend/dist/`.
- `npm run preview`: previews that build with the configured API proxy.
- `npm run lint`: checks frontend/backend and repository tooling.
- `npm test`: runs registered suites; integration suites require an isolated configured database/API.
- `npm run guides`: opens reference documentation at `http://127.0.0.1:4174`.
- `npm run guides:check`: verifies the reference reader and its documents.

See [deployment](guides/project/DEPLOY.md), [repository organization](guides/project/structure.md), and [file takeaways](guides/repository-takeaways.md). Payment submission requires provider verification; refund records track manual settlement.
