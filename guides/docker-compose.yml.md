# College Compose services

[Source](../docker-compose.yml). Builds frontend/backend from root with their separate Dockerfiles. Only explicit public variables enter frontend build arguments; `VITE_API_URL` is always `/api`. Missing public Supabase settings fail interpolation.

Backend uses a raw runtime env file (Compose 2.30+) and forced production/5252 settings; debug/test helpers remain false. The worker override defaults false. Frontend publishes 4242 (configurable binding/host port) and waits for backend health; backend is internal only. Both services restart unless stopped and have init/health checks. Project identity remains the existing directory/environment default.

Use `config --quiet` to avoid printing credentials. Read [the runbook](project/college-deployment.md) before starting services against a database or changing the college port/ingress.

The default runtime file is `.env.backend`, distinct from public-only `.env`. Actual Compose fixture resolution confirmed backend-only credentials arrive there, the frontend receives only declared public build arguments, and worker ownership stays false. Configuration validation does not establish image/container execution.

