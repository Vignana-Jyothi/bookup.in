/** Buffered JSON/API fetch with a deadline covering headers and the entire body. */
export async function boundedFetch(input, options = {}, { timeoutMs = 15000, fetchImpl = globalThis.fetch } = {}) {
  const callerSignal = options.signal ?? (input instanceof Request ? input.signal : undefined);
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
  signal.throwIfAborted();
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(input, { ...options, signal });
        // Buffer before returning: a resolved fetch alone does not bound response.json().
        const body = await response.arrayBuffer();
        signal.throwIfAborted();
        const buffered = new Response([101, 204, 205, 304].includes(response.status) ? null : body, {
          status: response.status, statusText: response.statusText, headers: response.headers,
        });
        for (const name of ['url', 'redirected', 'type']) {
          Object.defineProperty(buffered, name, { value: response[name] });
        }
        return buffered;
      })(),
      aborted,
    ]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
