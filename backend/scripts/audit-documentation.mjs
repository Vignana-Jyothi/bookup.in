import fs from 'node:fs';
import path from 'node:path';

// Pipe `git ls-files --cached --others --exclude-standard | ConvertTo-Json`.
// Include uncommitted maintained source; never read credentials.
let input = '';
for await (const chunk of process.stdin) input += chunk;
const listed = JSON.parse(input.replace(/^\uFEFF/, ''));
if (!Array.isArray(listed) || listed.some(file => typeof file !== 'string' || file.includes('..'))) {
  throw new Error('Expected a JSON array of repository-relative file names.');
}
const roots = /^(frontend\/(src|api|server)\/|backend\/(server|scripts|tests|supabase)\/|\.github\/workflows\/)/;
const extension = /\.(jsx?|mjs|cjs|css|sql|ya?ml|json)$/;
const excluded = /\/data\/|\/backups\//;
const shared = new Set(['package.json', 'run-dev.js', '.env.example', '.gitignore',
  'frontend/vite.config.js', 'frontend/vercel.json', 'frontend/index.html',
  'frontend/.oxlintrc.json', 'backend/render.yaml']);
const files = [...new Set(listed)].filter(file => fs.existsSync(file) &&
  ((roots.test(file) && extension.test(file) && !excluded.test(file)) || shared.has(file)));
const aggregatePaths = ['guides/frontend/src/takeaways.md', 'guides/backend/server/takeaways.md',
  'guides/backend/supabase/takeaways.md', 'guides/backend/tests/takeaways.md'];
const aggregates = aggregatePaths.map(file => ({ file, body: fs.readFileSync(file, 'utf8') }));
const records = files.sort().map(file => {
  const guide = `guides/${file}.md`;
  const exists = fs.existsSync(guide);
  const body = exists ? fs.readFileSync(guide, 'utf8') : '';
  const aggregateGuide = aggregates.find(item => file.startsWith(item.file.slice(7, -13)) && item.body.includes(path.basename(file)))?.file || null;
  return { file, guide, mirrored: exists, aggregateGuide, shortGuide: exists && body.length < 450,
    explicitReviewMarker: exists && /^(?:\*\*)?(?:status|review status):\s*(?:unreviewed|inventory only|pending review)/im.test(body) };
});
const counts = {
  files: records.length,
  mirrored: records.filter(item => item.mirrored).length,
  missing: records.filter(item => !item.mirrored).length,
  aggregateOnly: records.filter(item => !item.mirrored && item.aggregateGuide).length,
  unmapped: records.filter(item => !item.mirrored && !item.aggregateGuide).length,
  shortGuides: records.filter(item => item.shortGuide).length,
  explicitReviewMarkers: records.filter(item => item.explicitReviewMarker).length,
};
if (process.argv.includes('--write')) {
  const directory = 'guides/project';
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'documentation-coverage.json'), JSON.stringify({ counts, records }, null, 2) + '\n');
  let md = '# Documentation Coverage Inventory\n\n';
  md += '[Audit conclusions](documentation-audit-20261019.md). Snapshot of Git-listed first-party source, tests, migrations, workflow and selected shared configuration, including untracked maintained files when supplied by the documented command. Excludes dependencies, generated output, assets, reference prototypes, secrets and token/backup directories.\n\n';
  md += `**${counts.files} files; ${counts.mirrored} exact mirrored guides; ${counts.missing} missing exact mirrors; ${counts.shortGuides} short guides; ${counts.explicitReviewMarkers} explicit review markers.**\n\n`;
  md += 'Presence is not correctness or full function coverage. Short length is a review hint, not proof of inadequate documentation. A missing mirror can still have a folder takeaway or project implementation guide. Git does not identify which conversational agent authored a file.\n\n';
  md += '| Source | Exact mirror | Review hint |\n| --- | --- | --- |\n';
  for (const item of records) {
    const hints = [item.shortGuide ? 'Short guide' : '', item.explicitReviewMarker ? 'Review marker' : ''].filter(Boolean).join('; ') || '-';
    md += `| [${item.file}](../../${item.file}) | ${item.mirrored ? `[Guide](../${item.file}.md)` : item.aggregateGuide ? `[Folder summary only](../${item.aggregateGuide.slice(7)})` : 'Missing; no aggregate entry found'} | ${hints} |\n`;
  }
  fs.writeFileSync(path.join(directory, 'documentation-coverage.md'), md);
}
console.log(JSON.stringify(counts, null, 2));
if (process.argv.includes('--check') && (counts.missing || counts.explicitReviewMarkers)) process.exitCode = 1;
