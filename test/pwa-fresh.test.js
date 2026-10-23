// Effects stay on for every phone (only reduced motion and the Animations switch turn them off), and installed
// copies never run stale files (game-night-home #9 fix, now in shared/pwa/make-pwa.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const pub = new URL('../public/', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, pub), 'utf8');
const js = (d = 'js/') => fs.readdirSync(new URL(d, pub)).filter((f) => f.endsWith('.js')).map((f) => d + f);

test('no core-count or memory check gates motion', () => {
  for (const f of js()) assert.doesNotMatch(read(f), /hardwareConcurrency/, `${f} checks core count`);
});
test('service worker: HTML fetched with no-cache; open pages reload once on update', () => {
  const sw = read('sw.js');
  assert.match(sw, /fetch\(req, \{ cache: 'no-cache' \}\)/);
  assert.match(sw, /updated[\s\S]*navigate\(c\.url\)/);
  assert.match(sw, /skipWaiting\(\)/);
});
test('index.html registers with updateViaCache none and reloads once on controllerchange', () => {
  const idx = read('index.html');
  assert.match(idx, /updateViaCache:'none'/);
  assert.match(idx, /controllerchange[\s\S]*swReloaded=true;location\.reload\(\)/);
});
