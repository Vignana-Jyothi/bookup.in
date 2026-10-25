# College HTTP routing

[Source](../nginx.conf). The protocol map accepts only http/https from ingress; the status map gives successful assets immutable caching and failed assets no-store. The server serves compiled files on 4242, sets conservative document/security headers and supports 12 MiB multipart requests.

Exact `/healthz` is static; `/health`, `/api` and `/api/` proxy unchanged through Docker DNS to backend 5252. Headers preserve host/protocol/client chain; standard proxy behavior preserves separate Set-Cookie headers and raw request bodies. No Vercel handler runs here. API routes outrank file/SPA fallback.

Assets, raw source, dotfiles and file-extension misses return 404; application deep links fall back to index.html. Runtime 502/504 errors remain upstream errors. Validate ingress trust and HTTPS cookies as described in [operations](project/college-deployment.md); syntax/container checks require Linux Nginx.

