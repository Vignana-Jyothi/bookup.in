# College deployment regression

[Source](../../../backend/tests/test-college-deployment.js). Checks public/backend separation, ignored tokens, same-origin routing, project mismatch, privileged browser keys, multiline rejection and incomplete enabled integrations. A private OS-temp directory verifies raw `$`/quote/hash values and stale-file replacement, then is removed.

URL regression coverage verifies calup.app defaults, Google callback derivation with configured credentials, trailing-slash normalization, stale testing-host/local origins and wrong callback paths. These fixture tests do not register or change any provider dashboard URL.

Runs actual API startup in-process on an ephemeral local port with fixture-only settings. A fetch guard rejects and records nonlocal requests; `/health` must return ok and disabled workers must make zero external requests. Finally restores fetch and closes the HTTP server/connections. Uses no real credentials, database, notification or payment.

