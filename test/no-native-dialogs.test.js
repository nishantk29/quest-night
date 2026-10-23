import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dir = new URL('../public/js/', import.meta.url);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));

test('no native confirm(/alert(/prompt( in public/js (they freeze phone tabs)', () => {
  for (const f of files) {
    const src = fs.readFileSync(new URL(f, dir), 'utf8');
    const hits = src.split('\n').filter((l) => /(^|[^\w.])(window\.)?(confirm|alert|prompt)\s*\(/.test(l));
    assert.deepEqual(hits, [], `${f} uses a native dialog`);
  }
});

test('askConfirm is a dialog sheet with confirmYes/confirmNo', () => {
  const src = fs.readFileSync(new URL('table_ui.js', dir), 'utf8');
  assert.match(src, /export function askConfirm/);
  assert.match(src, /dataset\.a = 'confirmYes'/);
  assert.match(src, /dataset\.a = 'confirmNo'/);
});
