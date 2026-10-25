# College migration implementation and evidence

## State

Prepared locally on `migration/college-docker`, based on the user's `bd8a76d` pre-migration source commit. `origin` remains the source repository; `college` points to `Vignana-Jyothi/bookup.in`. No remote push, history merge, hosted configuration, database migration or production deployment succeeded or was performed in this environment.

Implementation commits:

- `a18cdc6`: container images, Compose/Nginx, production/validation workflows, public/runtime settings, worker switch, isolated checks and deployment guides.
- `2bda41b`: clean-source token-storage regression accepts the correctly absent ignored legacy cache without creating one.
- `dbe8fe9`: generated source exports remain ignored; the user's prior artifact/source baseline is retained.
- `f20cb07`: Compose defaults to the generated `.env.backend` runtime file rather than the public-only `.env`.

See the tracked [deployment runbook](college-deployment.md) for source promotion, settings and recovery.

## Implemented behavior

| Area | Result |
|---|---|
| College deployment | Main -> hosted Linux validation -> existing gamma runner -> Compose; production jobs serialize |
| Current layout | Frontend image builds frontend/dist; non-root Node image starts backend/server/index.js |
| Routing | Nginx on 4242; backend internal 5252; same-origin API, cookie/raw-body forwarding, SPA/resource distinction, conservative HTML/version caching |
| Settings | Allowlisted JSON inputs generate public Compose/build settings and separate raw backend settings; privileged browser keys and invalid/incomplete settings fail validation |
| Recovery | Existing image pair tagged before build; private previous backend environment retained for same-run rollback; bounded health/delivery checks |
| Test hosting | Existing Vercel/Render files retained; Vercel workflow restricted to original source repository |
| Workers | Existing hosts keep their default; Docker starts automatic jobs disabled until ownership is assigned |
| Documentation | Selected deployment guides explicitly tracked despite general local guides ignore policy |

## Local verification

- `npm run lint:ci`: exit 0; existing warnings remain.
- `npm run test:isolated`: all 12 suites pass, both in the workspace and exported source.
- `npm run build`: passes in both locations; existing large-chunk/performance advisory remains.
- `npm audit --omit=dev --audit-level=high --json`: reports zero production vulnerabilities.
- YAML parsing succeeds for Compose and all three workflow files.
- Compose configuration validation succeeds. Resolving generated fixture settings confirms the privileged key reaches only backend runtime settings, `/api` is fixed for the frontend and worker ownership defaults false.
- Public/runtime fixture strings containing quotes, hashes and dollar signs survive canonical Compose resolution (accounting for the CLI's doubled-dollar serialization).
- Export verification checked all 506 tracked blobs at `dbe8fe9`: none missing or semantically different; 416 have only Windows CRLF conversion. Shell scripts remain LF. The subsequent Compose default change was copied from its committed blob and checked through actual Compose configuration resolution.
- `npm run guides:check` passes; source/diff whitespace checks pass.

The export uses existing installed dependencies resolved through parent directories; a new network-backed npm installation is not claimed. Generated logs, zip and machine evidence are local under ignored `artifacts/college-migration/` plus ordinary ignored log files. No application secrets were copied into the export or image build context.

## Outstanding external verification

1. Direct GitHub Git access fails through the sandbox's blocked proxy. The attempted source-branch push failed. Fetching college main and reconciling its history therefore remain unfinished; do not force-push a replacement tree.
2. Docker CLI/Compose work, but the Docker engine is unavailable. Attempting to start Docker Desktop did not produce a usable engine. Image builds, Nginx execution, real container health and automatic rollback have not run locally.
3. Local Git Bash cannot start because Windows denies its signal pipe; Bash syntax validation is present in hosted Linux CI but has not run there yet.
4. College gamma availability, existing Compose project/ingress, secret names/values, production schema/RPC readiness, external redirects/webhooks and worker ownership still require operator/server evidence.
5. Hosted Vercel/Render and real browser login/booking/payment flows were not changed or revalidated by this implementation.

## Next execution

From a terminal with GitHub access, push `migration/college-docker` to the source repository to run hosted validation. Fetch college main and review/reconcile the migration branch against it. With the engine/server/configuration checks complete and CI passing, promote the reviewed release to college main and verify the deployed revision at calup.app. Keep Vercel and Render enabled. The local branch is prepared; production migration is not complete.
