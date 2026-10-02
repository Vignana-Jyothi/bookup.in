# CalUp (BookUp) — Deployment & Production Guide

This document details the exact requirements, commands, environment configurations, and external credentials needed to build, run, and host CalUp in development, staging, and production.

---

## 1. Prerequisites & Node Version

- **Node.js**: `v18.0.0` or higher required (Recommended: `v20.x` or `v22.x` LTS).
- **Package Manager**: `npm` (bundled with Node.js) or `pnpm` / `yarn`.
- **Database**: Active Supabase project with PostgreSQL schema.
- **External Accounts** (Optional / Conditional):
  - Google Cloud Console project (for Google Calendar & Meet integration).
  - Resend account (for transactional email delivery).
  - RichAutomate account (for WhatsApp notification delivery).

To verify your Node version:
```bash
node -v
# Output should be >= v18.0.0
npm -v
```

---

## 2. Quick Command Reference

| Action | Command | Description |
| :--- | :--- | :--- |
| **Install Dependencies** | `npm install` | Installs all client, server, and dev dependencies |
| **Run Full Dev Environment** | `npm run dev` | Runs backend (port 3001) & Vite frontend (port 5173) concurrently |
| **Run Frontend Only** | `npm run client` | Starts Vite development server at `http://localhost:5173` |
| **Run Backend Only** | `npm run server` / `npm start` | Starts Express backend server on `PORT` (default 3001) |
| **Build Frontend** | `npm run build` | Compiles optimized static production assets into `dist/` |
| **Preview Built Frontend** | `npm run preview` | Serves compiled `dist/` bundle locally on port 5173 |
| **Run Test Suite** | `npm test` | Runs the full verification test suite (15 automated test suites) |
| **Code Linting** | `npm run lint` | Runs `oxlint` static code analysis |

---

## 3. Architecture & Hosting Strategy

CalUp is architected as a decoupled system:
- **Frontend**: Single Page Application (React 19, Vite, React Router 7, Vanilla CSS).
- **Backend**: REST API Server (Node.js, Express 5, Supabase JS SDK, Google APIs).
- **Database & Auth**: Supabase (PostgreSQL, Row Level Security, Auth).

### Recommended Deployment: Split Architecture (Vercel + Render)

```
┌─────────────────────────────────┐        ┌──────────────────────────────────┐
│   Vercel (Frontend Hosting)     │        │    Render (Backend Hosting)      │
│   • Framework: Vite             │        │    • Environment: Node.js        │
│   • Build: npm run build        │  REST  │    • Start: npm start            │
│   • Output: dist/               │◄──────►│    • Port: 3001 (or $PORT)       │
│   • Env: VITE_*                 │        │    • Health Check: /health       │
└─────────────────────────────────┘        └──────────────────────────────────┘
                 │                                           │
                 │                                           │
                 ▼                                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Supabase Database (PostgreSQL)                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### A. Serving the Frontend (Vercel)
1. Import repository into [Vercel](https://vercel.com).
2. Configure Project Settings:
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`
3. Add Client Environment Variables (see `.env.example`):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_APP_URL` (e.g. `https://yourdomain.com` or `https://your-app.vercel.app`)
   - `VITE_API_URL` (e.g. `https://your-backend.onrender.com`)
   - `VITE_SUPPORT_EMAIL` (e.g. `support@yourdomain.com`)
   - `VITE_DEMO_SLUG` (e.g. `dr-arjun-patel`)
4. The included `vercel.json` ensures all SPA routes (`/book/*`, `/manage/*`, `/track/*`, `/dashboard/*`) route properly to `index.html` with cache-control headers.

#### B. Running the Backend (Render / Railway / VPS)
1. Create a Web Service in [Render](https://render.com) using `render.yaml` or manual setup:
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start` (or `node server/index.js`)
   - **Health Check Path**: `/health`
2. Add Server Environment Variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `TOKEN_ENCRYPTION_KEY` (Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   - `FRONTEND_URL` (e.g. `https://yourdomain.com`)
   - `CORS_ORIGIN` (Optional extra origins)
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI` (Must match Google Console redirect URI)
   - `RESEND_API_KEY`
   - `RESEND_FROM_EMAIL` (Must match verified domain in Resend)
   - `INTERNAL_CRON_SECRET`
3. Startup Validation:
   The backend runs strict validation at startup (`validateConfig()`). If any required variable (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FRONTEND_URL`, `TOKEN_ENCRYPTION_KEY`, or conditional OAuth/email variables) is omitted, the process **fails loudly with exit code 1** to prevent runtime failures in production.

---

## 4. HTTPS Requirement

> [!IMPORTANT]
> **HTTPS is strictly required in production.**

1. **Google OAuth 2.0 Security**:
   - Google Identity Services and OAuth 2.0 forbid unencrypted `http://` callback endpoints in production. The only non-HTTPS origin permitted by Google is `http://localhost`.
   - Production redirect URIs must begin with `https://`.
2. **Web Crypto & Browser Storage**:
   - Modern browser security contexts restrict `crypto.subtle` and secure cookies to HTTPS domains.
3. **Platform Certificate Management**:
   - When deploying frontend to Vercel and backend to Render, free automated Let's Encrypt SSL/TLS certificates are provisioned and renewed automatically. Ensure custom domains have completed DNS validation (CNAME/A records) before pointing live traffic.

---

## 5. Google OAuth 2.0 Setup & Redirect URI Registration

To enable coaches to connect Google Calendar and automatically generate Google Meet video links for bookings, follow these steps:

### Step 1: Google Cloud Console Configuration
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Select or create a project (e.g. `CalUp Production`).
3. Enable the **Google Calendar API** under **APIs & Services > Library**.
4. Configure the **OAuth consent screen** (**APIs & Services > OAuth consent screen**):
   - User Type: **External**
   - App name: `CalUp` (or your brand name)
   - User support email: your support email
   - Developer contact email: your technical contact email
   - Scopes: `https://www.googleapis.com/auth/calendar.events` and `https://www.googleapis.com/auth/calendar.readonly`

### Step 2: Register Credentials
1. Go to **APIs & Services > Credentials** > **Create Credentials** > **OAuth Client ID**.
2. Application type: **Web application**.
3. Name: `CalUp Web Client`.
4. **Authorized JavaScript origins**:
   - Local: `http://localhost:5173`
   - Production: `https://<your-frontend-domain>` (e.g. `https://calup.in` or `https://calup-in.vercel.app`)
5. **Authorized redirect URIs**:
   - Local development:
     ```
     http://localhost:5173/api/auth/google/callback
     ```
   - Production (registered in Google Cloud Console and set as `GOOGLE_REDIRECT_URI` in backend):
     ```
     https://<your-frontend-domain>/api/auth/google/callback
     ```
     *(If the frontend reverse-proxies `/api` to the backend)*
     **OR**
     ```
     https://<your-backend-domain>/api/auth/google/callback
     ```
     *(If direct redirect to the backend API domain)*

### Step 3: Set Environment Variables
Copy the generated values into your backend environment:
```env
GOOGLE_CLIENT_ID=<Client ID from Google Console>
GOOGLE_CLIENT_SECRET=<Client Secret from Google Console>
GOOGLE_REDIRECT_URI=https://<your-domain>/api/auth/google/callback
```

> [!WARNING]
> `GOOGLE_REDIRECT_URI` in `.env` must match character-for-character with the Authorized Redirect URI saved in Google Cloud Console, including scheme (`https://`), domain, path, and port (if any). Mismatches will trigger Google error `redirect_uri_mismatch`.

---

## 6. Verification Checklist Before Going Live

- [ ] All required variables from `.env.example` configured in hosting dashboards.
- [ ] No real secrets or `.env` files committed to repository (`.gitignore` verified).
- [ ] Custom domain DNS propagated and SSL certificates active.
- [ ] Google OAuth consent screen verified or test users added.
- [ ] Resend sender domain verified via DNS (DKIM, SPF, DMARC records).
- [ ] Backend `/health` returns `{ "status": "ok" }`.
- [ ] Run full test suite: `npm test` passes cleanly (15/15 test suites).
