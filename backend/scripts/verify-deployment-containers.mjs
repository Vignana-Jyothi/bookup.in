import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, access } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { prepareCollegeEnvironment, writeCollegeEnvironment, fixtureSettings } from './college-env.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
function execute(command, args, { env, capture = false }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
    let output = '';
    child.stdout?.on('data', chunk => { output += chunk; });
    child.on('error', () => reject(new Error('Could not start deployment test command.')));
    child.on('exit', code => code === 0 ? resolve(output.trim()) : reject(new Error(`Deployment test command failed: ${path.basename(command)} (exit ${code}).`)));
  });
}

export async function verifyDeploymentContainers({ run = execute, prepareOnly = false, log = console.log } = {}) {
  const artifacts = path.join(root, 'artifacts');
  await mkdir(artifacts, { recursive: true });
  const directory = await mkdtemp(path.join(artifacts, 'deployment-smoke-'));
  const settings = prepareCollegeEnvironment({ secrets: fixtureSettings, fixture: true });
  await writeCollegeEnvironment(settings, directory);
  const env = { ...process.env };
  // Shell settings must never replace the public/runtime fixture credentials.
  for (const key of Object.keys(env)) if (/^(VITE_|SUPABASE_|CASHFREE_|CALUP_DEPLOY_|BACKEND_ENV_FILE$|COMPOSE_)/.test(key)) delete env[key];
  Object.assign(env, { FRONTEND_PORT: '14242', FRONTEND_BIND_ADDRESS: '127.0.0.1', BACKEND_PORT: '15252',
    BACKEND_BIND_ADDRESS: '127.0.0.1', BACKGROUND_WORKERS_ENABLED: 'false', BACKEND_ENV_FILE: path.join(directory, '.env.backend') });
  const project = `calup-ci-${randomBytes(6).toString('hex')}`;
  const compose = ['compose', '--project-name', project, '--env-file', path.join(directory, '.env'), '-f', path.join(root, 'docker-compose.yml')];
  if (prepareOnly) { log('Prepared synthetic Docker fixtures under artifacts; no original env files changed.'); return; }
  if (env.DOCKER_HOST) throw new Error('Use a local Docker context without a DOCKER_HOST override for these tests.');
  await run('docker', ['version'], { env });
  const endpoint = await run('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { env, capture: true });
  if (!/^(?:npipe|unix):\/\//.test(endpoint)) throw new Error('Container smoke tests require a local Docker socket. Remote contexts are rejected.');
  const existing = await run('docker', [...compose, 'ps', '-aq'], { env, capture: true });
  if (existing) throw new Error('Refusing to reuse a Docker project with existing containers.');
  await run('docker', [...compose, 'config', '--quiet'], { env });
  const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  await run(process.execPath, [npmCli, 'audit', '--offline=false', '--omit=dev', '--audit-level=high'], { env });
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  if (process.platform === 'win32') await access(bash);
  await run(bash, ['-n', 'backend/scripts/college-deploy.sh'], { env });
  let started = false;
  try {
    started = true;
    await run('docker', [...compose, 'up', '-d', '--build', '--wait', '--wait-timeout', '180'], { env });
    await run(process.execPath, ['backend/scripts/verify-docker.mjs', 'http://127.0.0.1:14242'], { env });
    for (const port of ['14242', '15252']) {
      await run(process.execPath, ['backend/scripts/verify-public-api.mjs', `http://127.0.0.1:${port}`], { env });
    }
    log('PASS: fresh registry audit, deploy shell syntax, Docker builds/health, SPA/cache/security and both API ingress paths.');
  } finally {
    if (started) await run('docker', [...compose, 'down', '--remove-orphans'], { env });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--prepare-only')) { console.error('Only --prepare-only is supported.'); process.exitCode = 1; }
  else verifyDeploymentContainers({ prepareOnly: args.includes('--prepare-only') }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
