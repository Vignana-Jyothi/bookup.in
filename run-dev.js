/**
 * BookUp Unified Dev Server Runner
 * Spawns both Express backend (port 3001) and Vite client (port 5173) cleanly across platforms.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

console.log('Starting Calup backend (3001) and live frontend (5173)...\n');

const server = spawn(process.execPath, ['--watch', 'backend/server/index.js'], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: false,
});

const client = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'frontend', '--configLoader', 'native'], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: false,
});

let stopping = false;
function cleanup(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of [server, client]) {
    if (child.exitCode === null && !child.killed) child.kill();
  }
  process.exitCode = code;
}

for (const [name, child] of [['Backend', server], ['Frontend', client]]) {
  child.on('error', error => {
    console.error(`${name} could not start: ${error.message}`);
    cleanup(1);
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`${name} stopped (${signal || code}). Stopping the paired development server.`);
    cleanup(code || 1);
  });
}
process.on('SIGINT', () => cleanup());
process.on('SIGTERM', () => cleanup());
process.on('exit', () => cleanup());
