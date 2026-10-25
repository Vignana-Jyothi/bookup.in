# Isolated release test runner

[Source](../../../backend/tests/run-isolated-tests.js). Selects 12 fixture/source-only suites, including deployment environment/runtime checks, onboarding/services, both cookie proxies, delivery, scheduling, OAuth storage and subscription contracts.

Clears settings named by `.env.example`, overlays fixture public/server values, disables workers/test helpers and spawns each suite with a two-minute timeout. Any child error/nonzero exit stops the runner. It does not replace full integration `npm test` or supply a real database. Source-based checks need tracked source but no local guides tooling.

