import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verifyDeploymentContainers } from '../scripts/verify-deployment-containers.mjs';

let calls = []; let remote = false; let failBuild = false;
const invoke = async (command, args, { env }) => {
  calls.push({ command, args });
  if (command !== 'docker') return '';
  if (args[0] === 'context') return remote ? 'ssh://production-host' : 'unix:///var/run/docker.sock';
  if (args[0] === 'compose') {
    assert.match(args[2], /^calup-ci-[a-f0-9]{12}$/);
    assert.equal(env.FRONTEND_BIND_ADDRESS, '127.0.0.1');
    assert.equal(env.BACKEND_BIND_ADDRESS, '127.0.0.1');
    assert.equal(env.BACKGROUND_WORKERS_ENABLED, 'false');
    assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined);
    const fixture = await readFile(env.BACKEND_ENV_FILE, 'utf8');
    assert.match(fixture, /SUPABASE_SERVICE_ROLE_KEY=ci-fixture-server-key/);
    if (failBuild && args.includes('up')) throw new Error('Fixture build failed');
  }
  return '';
};
const oldHost = process.env.DOCKER_HOST;
delete process.env.DOCKER_HOST;
try {
  await verifyDeploymentContainers({ run: invoke, log: () => {} });
  assert(calls.some(call => call.args.includes('verify-docker.mjs') || call.args.includes('backend/scripts/verify-docker.mjs')));
  const compose = calls.filter(call => call.args[0] === 'compose');
  assert.equal(new Set(compose.map(call => call.args[2])).size, 1);
  assert(compose.at(-1).args.includes('down'));
  calls = []; failBuild = true;
  await assert.rejects(verifyDeploymentContainers({ run: invoke, log: () => {} }), /Fixture build failed/);
  assert(calls.at(-1).args.includes('down'), 'Partial build/start failure cleans up only the test project');
  calls = []; remote = true; failBuild = false;
  await assert.rejects(verifyDeploymentContainers({ run: invoke, log: () => {} }), /Remote contexts are rejected/);
  assert(!calls.some(call => call.args[0] === 'compose'), 'No mutation or cleanup against a remote Docker context');
} finally {
  if (oldHost === undefined) delete process.env.DOCKER_HOST; else process.env.DOCKER_HOST = oldHost;
}
console.log('PASS: Docker runner uses fixture secrets/local ports, isolated cleanup on failure, and rejects remote contexts. No Docker commands executed.');
