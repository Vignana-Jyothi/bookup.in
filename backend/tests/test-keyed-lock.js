import assert from 'node:assert/strict';
import { withKeyedLock } from '../server/utils/keyedLock.js';

const locks = new Map();
const order = [];
let releaseFirst;
const firstGate = new Promise(resolve => { releaseFirst = resolve; });
const first = withKeyedLock(locks, 'provider-a', async () => {
  order.push('first');
  await firstGate;
  throw new Error('Fixture failure');
});
const rejected = assert.rejects(first, /Fixture failure/);
const second = withKeyedLock(locks, 'provider-a', () => { order.push('second'); return 42; });
await withKeyedLock(locks, 'provider-b', () => { order.push('independent'); });
assert.deepEqual(order, ['first', 'independent'], 'Same provider waits; unrelated provider proceeds');
assert.equal(locks.size, 1, 'Completed unrelated providers must leave no queue entries');
releaseFirst();
await rejected;
assert.equal(await second, 42, 'Task failure must release the next waiter');
assert.deepEqual(order, ['first', 'independent', 'second']);
assert.equal(locks.size, 0, 'Completed/failed provider queues must be released');
console.log('PASS: keyed lock ordering, independent keys, failure recovery and registry cleanup');
