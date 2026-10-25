# `backend/tests/test-google-token-storage-contract.js`

College clean-checkout correction: the legacy JSON cache is ignored and is correctly absent in fresh source/image contexts. The test now accepts an absent file, asserts saving tokens does not create one, and still requires an existing legacy file to remain empty and free of synthetic credentials. No cache is created for testing. This supersedes the historical file-existence requirement below.

[Source](../../../backend/tests/test-google-token-storage-contract.js). Verifies that Google credentials round-trip through the explicit memory-only test adapter, the ignored legacy JSON file stays empty, and the production token store has no filesystem dependency. It also checks that durable-write failures are surfaced instead of being treated as successful connections.

## Reviewed execution details (19 October 2026)

Top-level setup forces NODE_ENV=test and TOKEN_STORE_MEMORY_ONLY before dynamic tokenStore import. It saves synthetic credentials, checks decrypted round trip, verifies legacy disk cache remains an empty object and source has no fs dependency, then deletes the fixture. Run node backend/tests/test-google-token-storage-contract.js only in the intended local test environment. The test requires the legacy cache file to exist but does not validate real encryption keys/database durability, token refresh or Google OAuth. Never replace the synthetic values with real credentials for this contract.

Documentation/source review only; no remote operation or broad test suite was executed in this completion pass.
