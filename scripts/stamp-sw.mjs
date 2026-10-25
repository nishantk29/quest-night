#!/usr/bin/env node
// Stamp public/sw.js with a fresh VERSION, without a browser (CI-safe).
// Same hash as shared/pwa/make-pwa.mjs: sha256 over every precached file (path + bytes), first 10 hex chars.
// Icons, manifest and the PRECACHE list still come from make-pwa; this only refreshes VERSION, and fails if the
// PRECACHE list in sw.js no longer matches public/ (run make-pwa locally and commit in that case).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const pub = path.resolve(process.argv[2] || 'public');
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name), rel = '/' + path.relative(pub, f).split(path.sep).join('/');
    if (e.isDirectory()) walk(f);
    else if (rel === '/sw.js' || e.name.startsWith('.') || rel === '/_headers' || rel === '/_redirects') continue;
    else if (/^\/print\/.*\.pdf$/i.test(rel) && fs.statSync(f).size > 2 * 1024 * 1024) continue;
    else files.push(rel);
  }
})(pub);
files.sort();
const h = crypto.createHash('sha256');
for (const rel of files) h.update(rel + '\0').update(fs.readFileSync(path.join(pub, rel)));
const version = h.digest('hex').slice(0, 10);

const swPath = path.join(pub, 'sw.js');
const sw = fs.readFileSync(swPath, 'utf8');
const block = sw.match(/const PRECACHE = \[([\s\S]*?)\n\]/);
if (!block) { console.error('stamp-sw: no PRECACHE list in sw.js'); process.exit(1); }
const listed = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const want = ['/', ...files.filter((f) => f !== '/index.html')];
if (listed.join('\n') !== want.join('\n')) {
  const miss = want.filter((f) => !listed.includes(f)), extra = listed.filter((f) => !want.includes(f));
  console.error(`stamp-sw: PRECACHE is out of date (missing ${miss.join(', ') || 'none'}; extra ${extra.join(', ') || 'none'}). Run make-pwa locally and commit.`);
  process.exit(1);
}
const next = sw.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`);
if (next === sw) console.log(`stamp-sw: sw.js already at ${version}`);
else { fs.writeFileSync(swPath, next); console.log(`stamp-sw: VERSION -> ${version}`); }
