/** Buffered backend API fetch with one deadline for headers and the full body; no retries. */
export async function boundedFetch(input, options = {}, { timeoutMs = 10000, fetchImpl = globalThis.fetch } = {}) {
  const callerSignal = options.signal ?? (input instanceof Request ? input.signal : undefined);
  const controller = new AbortController();
  const signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal;
  signal.throwIfAborted();
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  const timer = setTimeout(() => controller.abort(new DOMException('Backend request timed out', 'TimeoutError')), timeoutMs);
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(input, { ...options, signal });
        const body = await response.arrayBuffer();
        signal.throwIfAborted();
        const buffered = new Response([101, 204, 205, 304].includes(response.status) ? null : body, {
          status: response.status, statusText: response.statusText, headers: response.headers,
        });
        for (const name of ['url', 'redirected', 'type']) Object.defineProperty(buffered, name, { value: response[name] });
        return buffered;
      })(),
      aborted,
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}
