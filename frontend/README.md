# Frontend

React/Vite browser application. `src/` contains pages, components, state, adapters, utilities, and styles; `public/` contains artwork; `index.html` mounts React.

Run `npm run client`, `npm run build`, or `npm run preview` from the repository root. Dependencies are installed once at the root. `vite.config.js` fixes the frontend root and reads the shared root `.env`; build output is `frontend/dist/`.

Vercel projects use `frontend` as their Root Directory, allow access to files outside that directory for shared dependencies, and use this folder's `vercel.json`. Configure `VITE_API_URL` for the separately hosted API.

See [frontend reference](../guides/frontend/README.md) and [deployment](../guides/project/DEPLOY.md).
