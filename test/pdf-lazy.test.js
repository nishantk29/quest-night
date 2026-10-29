// Tech review, Oct 28 2026: every phone downloaded the 688 KB of print PDFs on its first visit, because the service worker
// precached them. Opening a PDF is a navigation (the SW goes to the network for those), so precaching never helped
// offline. The print page stays precached; a PDF is fetched when opened and cached from then on (cache-first branch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const precache = [...sw.slice(sw.indexOf('const PRECACHE'), sw.indexOf('];', sw.indexOf('const PRECACHE'))).matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('the print page is precached, the PDFs are not', () => {
  for (const f of ['/print.html', '/print.css']) assert.ok(precache.includes(f), `${f} is not precached`);
  assert.ok(!precache.some((f) => /\.pdf$/i.test(f)), 'a PDF is in the precache');
});
test('the PDFs still ship in public/print, and print.html links to them', () => {
  const pdfs = readdirSync(new URL('../public/print/', import.meta.url)).filter((f) => f.endsWith('.pdf'));
  assert.ok(pdfs.length >= 2, pdfs.join(','));
  const html = readFileSync(new URL('../public/print.html', import.meta.url), 'utf8');
  for (const f of pdfs) assert.ok(html.includes(`/print/${f}`), `print.html does not link ${f}`);
});
test('same-origin GETs that are not navigations are cached on first fetch (so an opened PDF stays available)', () => {
  assert.match(sw, /const hit = await caches\.match\(req, \{ ignoreSearch: true \}\);[\s\S]*?caches\.open\(CACHE\)\.then\(\(c\) => c\.put\(req, copy\)\)/);
});
