# College rollout and rollback

[Source](../../../backend/scripts/college-deploy.sh). Runs from the existing gamma checkout. Checks Compose 2.30+ and configuration; records existing service containers and tags their images. A private JSON override captures old backend environment without printing values. Existing project identity and ingress port are retained.

`rollback` traps build/up/delivery failures and restores a complete prior image pair/environment where available. Build finishes before up; health waits are bounded; `verify-docker.mjs` checks the result. No production down/prune/schema operation occurs. First deployment without an old pair has no guaranteed automatic rollback.

Success records GITHUB_SHA and reports private state location. Runner cleanup may remove temporary recovery configuration; image tags and previous revision remain needed. Bash is enforced LF. See [operator recovery](../../project/college-deployment.md).

