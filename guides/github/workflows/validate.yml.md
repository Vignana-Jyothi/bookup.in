# Hosted release validation

[Source](../../../.github/workflows/validate.yml). Runs on PRs, dev/migration pushes or reusable workflow calls on ubuntu-latest. Uses public fixtures, no production secrets, with a 20-minute bound.

Installs the lockfile, checks Bash syntax, lints tracked source, runs isolated suites, builds and audits production dependencies. Clean fixture files then build/start a separate calup-ci Compose project on loopback:14242. Delivery checks must pass. The fixture-writer step has id `docker_fixtures`; cleanup uses `always() && steps.docker_fixtures.outcome == 'success'`. This cleans partial container startup after a successful fixture write, but skips Compose when npm install/audit or fixture creation failed before `.env.backend` existed. The original failure remains visible; no audit bypass or ignored cleanup error is introduced. Fixture images are not deployed to the college server. See [operations](../../project/college-deployment.md).

