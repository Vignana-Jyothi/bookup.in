#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Run from repository root on the existing gamma runner; preserve Compose project identity.
docker compose version
node -e 'const [a,b]=process.argv[1].replace(/^v/, "").split(".").map(Number); if(a<2||(a===2&&b<30)) throw Error("Docker Compose 2.30+ is required for raw runtime env files")' "$(docker compose version --short)"
docker compose -f docker-compose.yml config --quiet
# Read-only database gate: migrations are applied and verified separately.
node backend/scripts/verify-release-database.mjs .env.backend
release="${GITHUB_SHA:-local}"
state="$(mktemp -d "${RUNNER_TEMP:-/tmp}/calup-rollback.XXXXXX")"
frontend_id="$(docker compose ps -q frontend)"
backend_id="$(docker compose ps -q backend)"
rollback_ready=false

if [[ -n "$frontend_id" && -n "$backend_id" ]]; then
  docker image tag "$(docker inspect --format '{{.Image}}' "$frontend_id")" "calup-rollback-frontend:$release"
  docker image tag "$(docker inspect --format '{{.Image}}' "$backend_id")" "calup-rollback-backend:$release"
  # Capture the old backend environment without printing it or placing it in artifacts.
  docker inspect --format '{{json .Config.Env}}' "$backend_id" | node --input-type=module -e '
    import fs from "node:fs";
    const values=JSON.parse(fs.readFileSync(0,"utf8"));
    const environment=Object.fromEntries(values.map(v=>{const i=v.indexOf("=");return [v.slice(0,i),v.slice(i+1)]}));
    const release=process.argv[2];
    fs.writeFileSync(process.argv[1], JSON.stringify({services:{frontend:{image:`calup-rollback-frontend:${release}`},backend:{image:`calup-rollback-backend:${release}`,environment}}}),{mode:0o600});
  ' "$state/rollback.json" "$release"
  rollback_ready=true
fi

rollback() {
  code=$?
  trap - ERR
  echo 'Deployment failed; restoring previous images when a complete baseline exists.' >&2
  if [[ "$rollback_ready" == true ]]; then
    docker compose -f docker-compose.yml -f "$state/rollback.json" up -d --no-build --pull never --wait --wait-timeout 180 || echo 'Automatic rollback failed; inspect the runner and existing containers.' >&2
  else
    echo 'No complete previous frontend/backend pair was available.' >&2
  fi
  exit "$code"
}
trap rollback ERR

# Build both images before replacing running containers. Never run compose down/prune.
docker compose -f docker-compose.yml build
docker compose -f docker-compose.yml up -d --no-build --wait --wait-timeout 180
node backend/scripts/verify-docker.mjs "http://127.0.0.1:${FRONTEND_PORT:-4242}"
# A healthy frontend does not prove the college's separate /api ingress works.
node backend/scripts/verify-public-api.mjs https://calup.app
printf '%s\n' "$release" > "$state/deployed-revision"
echo "Calup containers passed delivery checks for revision $release"
echo "Previous-image tags retained; private rollback state: $state"
