// Serializes work for one key while allowing unrelated keys to proceed.
export async function withKeyedLock(locks, key, task) {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const queued = previous.then(() => gate);
  locks.set(key, queued);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (locks.get(key) === queued) locks.delete(key);
  }
}
