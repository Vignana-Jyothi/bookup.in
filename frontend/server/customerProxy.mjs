const proofNames = ['calup_attempt_v1', 'calup_attempt_reference_v1', 'calup_commerce_access', 'calup_commerce_challenge'];
const allowed = /^\/api\/v1\/public\/(?:booking-attempts(?:\/[A-Za-z0-9/-]+)?|checkout-sessions\/current(?:\/(?:open|refresh|complete))?|commerce\/[A-Za-z0-9._~-]+\/[A-Za-z0-9/_-]+|support\/tickets(?:\/[A-Za-z0-9/-]+)?)$/;

// Keep customer proof first-party when the SPA and API are on different sites.
export function createCustomerProxy({ fetchImpl = fetch,
  target = () => process.env.API_PROXY_TARGET || process.env.VITE_API_URL || '',
} = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'application/json');
    let upstream;
    try {
      const base = new URL(target());
      if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash
        || !['', '/', '/api', '/api/'].includes(base.pathname) || base.host === req.headers.host) throw new Error();
      const path = new URL(req.url, 'https://proxy.invalid');
      if (['/api/customer-proxy', '/api/customer-proxy.mjs'].includes(path.pathname)) {
        const route = req.query?.__calup_public_path ?? path.searchParams.get('__calup_public_path');
        if (typeof route !== 'string' || !/^[A-Za-z0-9._~/-]+$/.test(route)
          || route.split('/').some(part => part === '.' || part === '..')) throw new Error();
        path.pathname = '/api/v1/public/' + route;
      }
      path.searchParams.delete('__calup_public_path');
      if (!allowed.test(path.pathname)) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'Customer route not found.' })); }
      upstream = new URL(path.pathname + path.search, base.origin);
    } catch {
      res.statusCode = 503;
      return res.end(JSON.stringify({ error: 'Customer API connection is not configured.' }));
    }
    if (!['GET', 'POST', 'HEAD'].includes(req.method)) { res.statusCode = 405; return res.end(); }
    const headers = { Accept: 'application/json' };
    for (const name of ['content-type', 'origin', 'idempotency-key', 'x-support-context']) if (typeof req.headers[name] === 'string') headers[name] = req.headers[name];
    const proofs = String(req.headers.cookie || '').split(';').map(value => value.trim())
      .filter(value => proofNames.includes(value.split('=')[0]) && !/[\r\n]/.test(value));
    if (proofs.length) headers.cookie = proofs.join('; ');
    let body;
    if (req.method === 'POST') {
      if (req.body !== undefined) body = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body);
      else {
        const chunks = []; let size = 0;
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
      const result = await fetchImpl(upstream, { method: req.method, headers,
        ...(body === undefined ? {} : { body }), redirect: 'manual', signal: AbortSignal.timeout(25000) });
      if (result.status >= 300 && result.status < 400) throw new Error();
      const payload = await result.arrayBuffer();
      res.statusCode = result.status;
      for (const name of ['content-type', 'retry-after']) { const value = result.headers.get(name); if (value) res.setHeader(name, value); }
      const cookies = result.headers.getSetCookie().filter(value => proofNames.includes(value.split('=')[0]) && !/;\s*domain=/i.test(value));
      if (cookies.length) res.setHeader('Set-Cookie', cookies);
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(payload));
    } catch {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: 'The payment service could not be reached. Check payment status before trying again.' }));
    }
  };
}
