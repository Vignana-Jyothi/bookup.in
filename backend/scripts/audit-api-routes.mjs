import fs from 'node:fs';
import path from 'node:path';
import { openApiDocument } from '../server/openapi.js';

// Source-only inventory: never imports the listening app or invokes handlers.
const root = process.cwd();
const entry = fs.readFileSync(path.join(root, 'backend/server/index.js'), 'utf8');
const imports = new Map();
for (const match of entry.matchAll(/import\s+([^;]+?)\s+from\s+'\.\/routes\/([^']+)'/g)) {
  for (const symbol of match[1].replace(/[{}]/g, '').split(',').map(value => value.trim())) imports.set(symbol, match[2]);
}
const mounts = [];
for (const match of entry.matchAll(/app\.use\('([^']+)'([^\n]+)/g)) {
  for (const [symbol, file] of imports) if (new RegExp(`\\b${symbol}\\b`).test(match[2])) mounts.push({ base: match[1], file, symbol });
}
const routes = [];
for (const file of fs.readdirSync(path.join(root, 'backend/server/routes')).filter(name => name.endsWith('.js'))) {
  const source = fs.readFileSync(path.join(root, 'backend/server/routes', file), 'utf8');
  const factories = [...source.matchAll(/export function (\w+)\(/g)];
  for (const match of source.matchAll(/router\.(get|post|put|patch|delete)\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g)) {
    const owner = factories.filter(factory => factory.index < match.index).at(-1)?.[1];
    for (const mount of mounts.filter(item => item.file === file && (!item.symbol.startsWith('create') || item.symbol === owner))) {
      for (const literal of match[2].matchAll(/['"]([^'"]*)['"]/g)) {
        const url = `${mount.base}${literal[1] === '/' ? '' : literal[1]}`;
        routes.push({ method: match[1].toUpperCase(), url, file, line: source.slice(0, match.index).split('\n').length, mount: mount.base });
      }
    }
  }
}
for (const match of entry.matchAll(/app\.(get|post|put|patch|delete)\(\s*(\[[^\]]*\]|'[^']*')/g)) {
  for (const literal of match[2].matchAll(/'([^']*)'/g)) routes.push({ method: match[1].toUpperCase(), url: literal[1], file: '../index.js', line: entry.slice(0, match.index).split('\n').length, mount: '' });
}
const normalize = value => value.replace(/:[A-Za-z0-9_]+|\{[^}]+\}/g, '{}').replace(/\/$/, '');
const documented = Object.entries(openApiDocument.paths).flatMap(([url, operations]) => Object.keys(operations)
  .filter(method => ['get', 'post', 'put', 'patch', 'delete'].includes(method)).map(method => ({ method: method.toUpperCase(), url })));
const missing = documented.filter(doc => !routes.some(route => route.method === doc.method && (
  normalize(route.url) === normalize(doc.url) || new RegExp(`^${route.url.replace(/:[A-Za-z0-9_]+/g, '[^/]+')}$`).test(doc.url)
)));
const grouped = Map.groupBy(routes, route => route.file);
let markdown = '# Implemented API Route Inventory\n\nGenerated from current source with `node backend/scripts/audit-api-routes.mjs --write`. ';
markdown += 'Source-only: includes aliases and gated diagnostic/test paths. This is a routing inventory, not proof of authorization or live availability. Factory mounts are resolved by source; middleware decisions are reviewed separately in the API audit.\n\n';
markdown += `${routes.length} mounted method/path combinations; ${documented.length} documented OpenAPI operations.\n\n`;
for (const [file, items] of grouped) {
  markdown += `## ${file}\n\n| Method | Mounted path | Source line |\n| --- | --- | --- |\n`;
  for (const item of items) markdown += `| ${item.method} | \`${item.url}\` | ${item.line} |\n`;
  markdown += '\n';
}
markdown += '## Documentation entries without a matched declaration\n\n';
markdown += missing.length ? missing.map(item => `- ${item.method} \`${item.url}\``).join('\n') : 'None found by structural path matching.';
markdown += '\n\nDynamic action/section values and conditional behavior require source review; wildcard matching does not validate accepted values. Legacy aliases are deliberately included, not recommended for new clients.\n';
if (process.argv.includes('--write')) {
  fs.writeFileSync(path.join(root, 'guides/project/api-route-inventory.md'), markdown);
  const files = fs.readdirSync(path.join(root, 'frontend/src'), { recursive: true })
    .filter(file => /\.(js|jsx)$/.test(file));
  let clientMarkdown = '# Frontend API and SDK Inventory\n\nSource-only scan of literal fetch/SDK calls; includes mocks and compatibility code, not proof that every method is reached in production. Wrapper clients and concrete routes are explained in the [API review](api-routing-review.md).\n\n';
  clientMarkdown += '| Source under frontend/src | Fetch calls | Supabase table/bucket names | RPC names | Auth operations |\n| --- | --- | --- | --- | --- |\n';
  for (const file of files.sort()) {
    const source = fs.readFileSync(path.join(root, 'frontend/src', file), 'utf8');
    const fetches = [...source.matchAll(/\bfetch\(/g)].length;
    const names = regex => [...new Set([...source.matchAll(regex)].map(match => match[1]))];
    const objects = names(/\.from\('([^']+)'\)/g);
    const rpcs = names(/\.rpc\('([^']+)'/g);
    const auth = names(/\bauth\.(\w+)\(/g);
    if (fetches || objects.length || rpcs.length || auth.length) clientMarkdown += `| ${file.replaceAll('\\', '/')} | ${fetches} | ${objects.join(', ') || '-'} | ${rpcs.join(', ') || '-'} | ${auth.join(', ') || '-'} |\n`;
  }
  fs.writeFileSync(path.join(root, 'guides/project/frontend-api-inventory.md'), clientMarkdown);
}
console.log(JSON.stringify({ mounted: routes.length, documented: documented.length, modules: grouped.size, documentationUnmatched: missing, mounts: mounts.length }, null, 2));
export { routes, mounts };
