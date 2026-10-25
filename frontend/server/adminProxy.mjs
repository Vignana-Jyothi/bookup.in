// Explicit ES module, outside api/ so only its entry is deployed.
export function createAdminProxy({ fetchImpl = fetch,
  target = () => process.env.API_PROXY_TARGET || process.env.VITE_API_URL || '',
} = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    let upstream;
    try {
      upstream = new URL(target());
      if (upstream.protocol !== 'https:' || upstream.username || upstream.password
        || upstream.search || upstream.hash || !['', '/', '/api', '/api/'].includes(upstream.pathname)) throw new Error();
      const path = new URL(req.url, 'https://proxy.invalid');
      if (path.pathname === '/api/admin-proxy' || path.pathname === '/api/admin-proxy.mjs') {
        const route = req.query?.__calup_admin_path ?? path.searchParams.get('__calup_admin_path');
        if (typeof route !== 'string' || !/^[A-Za-z0-9/-]+$/.test(route)) throw new Error();
        path.pathname = `/api/v1/admin/${route}`;
      }
      path.searchParams.delete('__calup_admin_path');
      if (!/^\/api\/v1\/admin\/[A-Za-z0-9/-]+$/.test(path.pathname)) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: 'Administrator route not found.' }));
      }
      if (upstream.host === req.headers.host) throw new Error();
      upstream = new URL(path.pathname + path.search, upstream.origin);
    } catch {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'Administrator API proxy is not configured.' }));
    }
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(req.method)) {
      res.statusCode = 405;
      return res.end();
    }
    const headers = { Accept: 'application/json' };
    for (const name of ['authorization', 'content-type', 'origin', 'idempotency-key', 'x-support-context']) {
      if (typeof req.headers[name] === 'string') headers[name] = req.headers[name];
    }
    // Never forward unrelated same-site cookies to the backend.
    const proof = String(req.headers.cookie || '').split(';').map(value => value.trim())
      .find(value => /^calup_admin_sms=[a-f0-9]{64}$/.test(value));
    if (proof) headers.cookie = proof;
    let body;
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (req.body !== undefined) body = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body);
      else {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += Buffer.byteLength(chunk);
          if (size > 262144) { res.statusCode = 413; return res.end(); }
          chunks.push(Buffer.from(chunk));
        }
        body = Buffer.concat(chunks);
      }
      if (Buffer.byteLength(body || '') > 262144) { res.statusCode = 413; return res.end(); }
    }
    try {
      const result = await fetchImpl(upstream, {
        method: req.method, headers, ...(body === undefined ? {} : { body }),
        redirect: 'manual', signal: AbortSignal.timeout(25000),
      });
      // Redirects must never forward credentials to a second host.
      if (result.status >= 300 && result.status < 400) throw new Error();
      const payload = await result.arrayBuffer();
      res.statusCode = result.status;
      for (const name of ['content-type', 'retry-after']) {
        const value = result.headers.get(name);
        if (value) res.setHeader(name, value);
      }
      const cookies = result.headers.getSetCookie().filter(value => /^calup_admin_sms=/.test(value) && !/;\s*domain=/i.test(value));
      if (cookies.length) res.setHeader('Set-Cookie', cookies);
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(payload));
    } catch {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Administrator API is temporarily unavailable. Check your session before retrying.' }));
    }
  };
}

