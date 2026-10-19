import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Run after vercel build, before deploying prebuilt artifacts.
export async function verifyAdminProxyOutput(root = '.vercel/output') {
  const config = JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'));
  const rule = config.routes?.find(item => item.src === '/api/v1/admin/(.*)');
  assert(rule?.dest?.startsWith('/api/admin-proxy?'), 'Missing explicit admin function route in deployment output');
  const functionRoot = path.join(root, 'functions', 'api', 'admin-proxy.func');
  const functionConfig = JSON.parse(await readFile(path.join(functionRoot, '.vc-config.json'), 'utf8'));
  assert.match(functionConfig.runtime, /^nodejs/, 'Admin bridge must be packaged as a Node function');
  assert((await stat(path.join(functionRoot, functionConfig.handler))).isFile(), 'Packaged admin handler is missing');
}

export async function verifyCustomerProxyOutput(root = '.vercel/output') {
  const config = JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'));
  const rule = config.routes?.find(item => item.src === '/api/v1/public/(.*)');
  assert(rule?.dest?.startsWith('/api/customer-proxy?'), 'Missing first-party customer API function route');
  const functionRoot = path.join(root, 'functions', 'api', 'customer-proxy.func');
  const fn = JSON.parse(await readFile(path.join(functionRoot, '.vc-config.json'), 'utf8'));
  assert.match(fn.runtime, /^nodejs/, 'Customer API bridge must be a Node function');
  assert((await stat(path.join(functionRoot, fn.handler))).isFile(), 'Packaged customer handler is missing');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await verifyAdminProxyOutput(process.argv[2]);
  await verifyCustomerProxyOutput(process.argv[2]);
  console.log('PASS: Vercel admin/customer cookie functions, handlers and explicit routes exist in prebuilt output.');
}
