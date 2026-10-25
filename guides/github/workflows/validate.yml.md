# Hosted release validation

[Source](../../../.github/workflows/validate.yml). Runs on PRs, dev/migration pushes or reusable workflow calls on ubuntu-latest. Uses public fixtures, no production secrets, with a 20-minute bound.

Installs the lockfile, checks Bash syntax, lints tracked source, runs isolated suites, builds and audits production dependencies. Clean fixture files then build/start a separate calup-ci Compose project on loopback:14242. Delivery checks must pass; an always step removes only CI containers. Fixture images are not deployed to the college server. See [operations](../../project/college-deployment.md).

