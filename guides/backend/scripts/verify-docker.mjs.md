# Running-stack delivery checks

[Source](../../../backend/scripts/verify-docker.mjs). `verifyDocker(origin)` performs time-bounded GET checks against a running stack (default localhost:4242). Verifies frontend/API health, SPA deep links, no-store HTML/version JSON, resource 404s, API/SPA isolation, entry JavaScript MIME and immutable asset cache.

CLI invokes the check against its optional URL argument. Failures throw assertions/nonzero exit; success reports checked categories. No authentication, database writes, payments, SMS or notifications. This does not establish database/RPC readiness or real-user cookie flows.

