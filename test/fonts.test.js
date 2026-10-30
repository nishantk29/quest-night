// Type rules (Nishant 2026-10-28: the art deco / decorative display stays in Mafia Night only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const pub = path.resolve('public');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

test('no decorative or art deco display face (Cinzel Decorative, Limelight, Poiret One) in the site', () => {
  const hits = walk(pub).filter((f) => /\.(css|html|js)$/.test(f) && /cinzel.decorative|limelight|poiret/i.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(pub, f));
  assert.deepEqual(hits, []);
  assert.deepEqual(fs.readdirSync(path.join(pub, 'fonts')).filter((f) => /decorative|limelight|poiret/i.test(f)), []);
});

test('wordmark and headings use Cinzel 800 (self-hosted, swap, preloaded); only Rubik and Cinzel 800 are preloaded', () => {
  const css = fs.readFileSync(path.join(pub, 'redesign.css'), 'utf8');
  assert.match(css, /@font-face\{font-family:"Cinzel";font-weight:800;font-display:swap;src:url\(\/fonts\/cinzel-800-core\.woff2\)/);
  assert.match(css, /\.wordmark\{font-family:var\(--display-serif\);font-weight:800/);
  const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  const pre = [...html.matchAll(/<link rel="preload" href="([^"]+)" as="font"/g)].map((m) => m[1]);
  assert.deepEqual(pre, ['/fonts/rubik-var.woff2', '/fonts/cinzel-800-core.woff2']);
});
