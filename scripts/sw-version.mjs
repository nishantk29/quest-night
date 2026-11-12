// Recomputes public/sw.js VERSION exactly as the shared make-pwa tool does (sha256 over sorted "/path\0" + bytes, first 10 hex).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function computeVersion(pub = 'public') {
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
  return h.digest('hex').slice(0, 10);
}

export function swVersion(pub = 'public') {
  const m = fs.readFileSync(path.join(pub, 'sw.js'), 'utf8').match(/const VERSION = '([0-9a-f]+)'/);
  return m && m[1];
}

export const FIX_HINT = 'run: node scripts/stamp-sw.mjs public';
