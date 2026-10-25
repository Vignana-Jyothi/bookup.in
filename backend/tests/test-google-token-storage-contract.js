import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.TOKEN_STORE_MEMORY_ONLY = 'true';

const { tokenStore } = await import('../server/services/tokenStore.js');
const providerId = 'google-token-memory-contract';
const accessToken = 'access-token-must-not-reach-disk';
const refreshToken = 'refresh-token-must-not-reach-disk';
const legacyPath = 'backend/server/data/tokens.json';
const legacyExisted = fs.existsSync(legacyPath);

await tokenStore.saveTokens(providerId, {
  email: 'host@example.com',
  accessToken,
  refreshToken,
  expiresAt: Date.now() + 60_000,
  scope: 'https://www.googleapis.com/auth/calendar.events',
});

const recovered = await tokenStore.getDecryptedTokens(providerId);
assert.equal(recovered.accessToken, accessToken);
assert.equal(recovered.refreshToken, refreshToken);

assert.equal(fs.existsSync(legacyPath), legacyExisted, 'Saving credentials must not create a disk cache');
const legacyFile = legacyExisted ? fs.readFileSync(legacyPath, 'utf8').trim() : '{}';
assert.equal(legacyFile, '{}', 'Legacy disk cache remains empty');
assert(!legacyFile.includes(accessToken));
assert(!legacyFile.includes(refreshToken));

const source = fs.readFileSync('backend/server/services/tokenStore.js', 'utf8');
assert(!source.includes("from 'fs'"), 'Production token store has no filesystem dependency');
assert.match(source, /Could not persist Google credentials/);
assert.match(source, /memoryOnlyTestMode/);

await tokenStore.deleteTokens(providerId);
console.log('PASS: Google token persistence is durable-first and disk-free.');
