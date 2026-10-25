# Frontend image

[Source](../Dockerfile.frontend). Node 22 installs lockfile dependencies and builds the current `frontend/` source into `frontend/dist/`. Declared public `VITE_*` ARG values are build-time inputs; no server credentials or root environment files are copied.

The final unprivileged Nginx 1.28 Alpine stage copies only compiled static files and `nginx.conf`, listens on 4242, and probes `/healthz`. Missing/privileged Supabase public configuration fails through the existing Vite validator. See [operations](project/college-deployment.md).

