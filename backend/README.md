# Backend

- `server/`: Express entry, routes, middleware, integrations, and utilities.
- `supabase/`: schema, migrations, and test fixtures.
- `tests/`: standalone Node suites, including frontend/backend integration coverage.
- `render.yaml`: deployment blueprint; select `backend/render.yaml` as the blueprint path while keeping the service working directory at repository root.

Run `npm run server` (or `npm start`) and `npm test` from the repository root. Dependencies and `.env` remain shared there. Individual suites run with `node backend/tests/test-<behavior>.js`; database suites need an isolated Supabase project.

See [backend reference](../guides/backend/README.md), [server details](../guides/backend/server/README.md), and [deployment](../guides/project/DEPLOY.md).
