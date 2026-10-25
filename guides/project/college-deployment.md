# College deployment at calup.app

## Hosting contract

Source development remains in `prateekthota18-boop/bookup.in`. Its `dev` branch continues to deploy Vercel; Render remains configured separately. A release promoted to `Vignana-Jyothi/bookup.in:main` runs `.github/workflows/deploy-main.yml`: hosted validation first, then the existing `gamma` runner builds and starts Compose. The server's existing TLS/domain routing must continue forwarding to port 4242. Nothing in this change creates DNS records or migrates Supabase data.

The baseline is `bd8a76d` (25 October 2026). This release uses `frontend/` and `backend/`; do not restore the college repository's old root `src/`/`server/` paths. The separate college `dev-ai` deployment is not used by this production workflow. Do not copy its old dev deployment workflow onto a testing branch unintentionally.

## Images and routing

- Root `Dockerfile.frontend` uses Node 22 to build `frontend/dist/`, then serves it from unprivileged Nginx on 4242. Only declared public Vite build arguments enter the build. No runtime secret file is copied.
- `Dockerfile.backend` installs production dependencies and runs `backend/server/index.js` as the Node user on internal port 5252. SQL, tests and development tooling are absent from runtime images.
- Compose publishes frontend 4242, with configurable `FRONTEND_BIND_ADDRESS`/`FRONTEND_PORT` for local verification. It leaves backend 5252 internal. Before the first deployment, verify the college ingress does not independently depend on the old published API port.
- `/healthz` checks Nginx; `/health` reaches Express without touching Supabase. `/api` routes preserve paths, queries, raw bodies and cookies. The existing Vercel proxy functions stay in source and are used only on Vercel.
- HTML and version JSON use no-store; existing hashed assets use immutable caching. Missing assets and unknown API routes never become the SPA. Nginx accepts up to 12 MiB, retaining the API's existing 10 MiB multipart-upload allowance and smaller JSON limit.
- Nginx resolves `backend` through Docker DNS after restarts. Forwarded protocol/host/client chain are supplied to Express; set `TRUST_PROXY` only for the verified ingress topology. Default 1 can group clients at a further ingress until configured. The outer ingress must replace untrusted forwarding headers, and direct access to 4242 should be governed by the college server's existing ingress policy.

## Configuration

Configure named settings as college GitHub repository secrets or variables. Secrets override nonempty variables. `college-env.mjs` filters the workflow input to an explicit application allowlist; GitHub/Vercel tokens are never written to application files. It rejects multiline values, invalid public URLs, mismatched frontend/backend Supabase projects, privileged browser keys, invalid encryption keys and incomplete enabled integrations. Errors identify variable names, not values.

Required:

| Setting | Requirement |
|---|---|
| `VITE_SUPABASE_URL` | HTTPS project origin; legacy `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_URL` can supply it |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser-safe public/anon key, never the service-role key |
| `SUPABASE_URL` | Same project as the frontend; defaults to its URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key for that project |
| `TOKEN_ENCRYPTION_KEY` | Existing 64-character hexadecimal encryption key for existing encrypted data; never rotate it as part of a hosting move |

Defaults are `VITE_APP_URL`, `FRONTEND_URL` and `BACKEND_PUBLIC_URL` = `https://calup.app`, `VITE_API_URL=/api`, support email `support@calup.app`, `TRUST_PROXY=1`. Explicitly set the relevant public demo, support and legal fields to the intended deployment values. Public Vite changes require an image rebuild.

Other supported settings follow `.env.example`: Google OAuth, Resend, 2Factor, Cashfree v1/refunds/commerce credentials and flags, Meta WhatsApp, legacy RichAutomate templates, CORS and internal cron. Enabled integrations require their credentials. Retain actual approved feature flags; do not copy template placeholder credentials. Google redirect and Supabase login/recovery allowlists must include the chosen origin; Cashfree callbacks/webhooks must target this API, with matching sandbox/production settings. Domain changes alone do not perform these provider updates.

The writer recreates two private files with restrictive permissions: root `.env` contains public Compose/build settings and the worker switch; `.env.backend` contains runtime settings in Compose `env_file: format: raw`. Raw format prevents `$`, `#` and quotes inside credentials from being reinterpreted. This requires **Docker Compose 2.30+**. Both files remain ignored and excluded from images. `ENABLE_TEST_ROUTES` and `DEBUG_ROUTES` are forced false in Docker. Do not print `docker compose config` without `--quiet` on the server, because it expands environment values.

`npm run deploy:env` requires `CALUP_DEPLOY_SECRETS` JSON and optional `CALUP_DEPLOY_VARIABLES` JSON; it does not import local `.env`. It intentionally replaces these two managed files. Never run the `--fixture` writer in a development directory containing your real root `.env`; CI uses a clean checkout. Environment-file writes occur after full settings validation.

## Worker and database ownership

Docker defaults `BACKGROUND_WORKERS_ENABLED=false`. Explicitly enable it on the API that owns background processing only after database/Render ownership is verified. This switch controls all seven automatic loops: payment reconciliation, Google sync, subscription lifecycle, support lifecycle, appointment WhatsApp, booking refunds and commerce payments. Existing Render/local configurations retain their old default when the variable is absent. Disabling loops does not disable normal user-triggered API writes or webhook handling.

Keep Vercel and Render available for testing. Prefer an isolated testing Supabase project plus sandbox payment/calendar/messaging credentials. Before college rollout, confirm database migrations/RPCs required by the current release and perform any required additive staging migrations separately. The workflow does not apply SQL. Never run the full integration suite against real customer data.

## Checks and promotion

1. Fetch both remotes and confirm current college `main`. Add the `college` remote separately; do not repoint `origin`.
2. Review the college diff and reconcile histories on the migration/release branch while preserving the current application tree and reviewed college workflow. Do not blindly force-push or merge old application code over the newer layout.
3. Check `gamma` online status, Docker engine/Compose 2.30+, ingress -> 4242, current Compose project name and container baseline. The script deliberately does not change the project name. Confirm database/schema, external URLs, feature flags and worker ownership.
4. Run `npm ci`, `npm run lint:ci`, `npm run test:isolated`, `npm run build` and `npm audit --omit=dev --audit-level=high`. Vercel continues to verify its two packaged first-party proxy functions separately. Run the full suite only with isolated integrations.
5. Hosted CI builds both images, starts a separate `calup-ci` Compose project using fixtures and port 14242, then checks Nginx/API health, SPA routing, absent resources, JS MIME/cache and version JSON. It has no production secrets and starts no workers. Fixture images are never promoted as production images; gamma rebuilds with actual public settings.
6. Push the reviewed release to college `main`; this is the automatic production trigger. Watch both validation and deploy jobs. Confirm the deployed commit and `https://calup.app` in a browser, including a controlled login/booking/integration check. Keep Vercel/Render enabled.

For local configuration-only checking, `BACKEND_ENV_FILE=.env.example docker compose --env-file .env.example config --quiet` uses placeholders and does not require an engine. Building/running containers requires the actual Docker engine. `node backend/scripts/verify-docker.mjs http://127.0.0.1:4242` tests a running stack, not a remote database.

## Failure and rollback

Production deployments serialize without canceling a running deployment. `college-deploy.sh` validates Compose, captures the current frontend/backend image pair, tags them `calup-rollback-frontend:<new-sha>` / `calup-rollback-backend:<new-sha>`, and stores a private rollback override under a random `RUNNER_TEMP/calup-rollback.*` directory. The override retains the previous backend environment; never upload it as a CI artifact.

Both new images build before any container is replaced. Compose waits up to 180 seconds for health, followed by delivery checks. On failure, the error trap attempts to restore the prior image pair and backend environment with `--no-build --pull never`. With no complete previous pair, automatic rollback cannot be promised; preserve the college baseline before first deployment. No `compose down`, prune, database restore or DNS change occurs during production deployment.

For a manual rollback while that run's private state still exists, run from the same checkout/project:

```bash
docker compose -f docker-compose.yml -f <private-rollback-directory>/rollback.json up -d --no-build --pull never --wait --wait-timeout 180
```

Runner temporary state may be cleaned after the job; keep the prior revision and image tags for operator recovery. Environment changes are managed separately after that cleanup. Image rollback does not undo SQL changes, bookings, payments, Calendar events or notifications. Follow the college's existing server access process to inspect logs; do not expose private rollback files.

## Implementation evidence

Local source tests and release checks are recorded in the implementation guide; they do not establish hosted settings, database readiness, image builds or a completed deployment. Live release acceptance requires the intended college commit to pass its workflow and run at the existing domain.
