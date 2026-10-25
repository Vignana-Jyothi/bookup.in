# College production workflow

[Source](../../../.github/workflows/deploy-main.yml). College main push/manual dispatch first calls hosted validation, then only the Vignana-Jyothi repository/main ref can use the existing gamma runner. Concurrency serializes production without canceling in-progress deployment.

Checkout credentials do not persist; Node 22 runs the environment writer with structured JSON secrets/variables, then Bash deploys/verifies/restores previous images on failure. Repository read permission only; no PR code runs on gamma. Settings are allowlisted and not logged. See [operations](../../project/college-deployment.md).

