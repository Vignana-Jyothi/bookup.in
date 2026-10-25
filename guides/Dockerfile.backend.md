# Backend image

[Source](../Dockerfile.backend). A Node 22 dependency stage runs `npm ci --omit=dev`. The runtime copies production modules, package metadata and `backend/server/` only, runs as the Node user and starts the actual Express entry point on 5252.

Docker/Compose health checks GET `/health` without database access. Startup still validates backend settings; absent required configuration fails rather than serving a broken API. Environment values arrive at runtime. See [operations](project/college-deployment.md).

