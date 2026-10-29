// Radius gate (Nishant approved the corner-radius tokens 2026-10-29 6:03 PM ET; run/mockups/corner-radius/side-by-side/NOTES.md).
// kit/radius-gate.mjs is a copy of /workspace/code-team/shared/gate/radius-gate.mjs. Every border-radius is a family token
// (--f-r-inset|field|card|sheet|pill|round|face), 0 or inherit; a raw value fails unless its selector is exempt below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { radiusAudit, okValue } from './kit/radius-gate.mjs';

const PUB = fileURLToPath(new URL('../public/', import.meta.url));
// Approved exemptions (game content and effects): fx particles
const EXEMPT = [/\.fx-p\b/];
// Not scanned: print.css (paper sheets) and pwa-install.js (the shared install banner).
const SKIP = new Set(['print.css', 'pwa-install.js', 'sw.js']);
const SKIP_DIRS = new Set(['vendor', 'fonts', 'icons', 'art', 'img']);
function files(dir = PUB) {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); if (statSync(p).isDirectory()) return SKIP_DIRS.has(f) ? [] : files(p); return /\.(css|js|html)$/.test(f) && !SKIP.has(f) ? [[p.slice(PUB.length), readFileSync(p, 'utf8')]] : []; });
}

test('radius gate: every border-radius is a named token (raw px fails outside the exemptions)', () => {
  const { bad, distinct } = radiusAudit(files(), EXEMPT);
  assert.deepEqual(bad, []);
  assert.ok(distinct.length <= 10, `distinct radius values ${distinct.length}: ${distinct.join(' | ')}`);
});
test('radius gate: the tokens are defined once with the approved values', () => {
  const css = files().filter(([f]) => f.endsWith('.css')).map(([, t]) => t).join('\n');
  for (const [k, v] of [['inset', '4px'], ['field', '12px'], ['card', '20px'], ['sheet', '28px'], ['pill', '999px'], ['round', '50%'], ['face', '6% / 4.3%']])
    assert.match(css, new RegExp(`--f-r-${k}:\\s*${v.replace(/[/%.]/g, '\\$&')}`), k);
});
test('radius gate is live', () => {
  assert.equal(okValue('14px'), false); assert.equal(okValue('var(--r-control)'), false); assert.equal(okValue('calc(var(--r-panel) - 3px)'), false);
  assert.equal(okValue('var(--f-r-card)'), true); assert.equal(okValue('var(--f-r-sheet) var(--f-r-sheet) 0 0'), true); assert.equal(okValue('calc(var(--f-r-field) - 3px)'), true);
  assert.deepEqual(radiusAudit([['x.css', '.a{border-radius:9px}.b{border-radius:var(--f-r-pill)}']]).bad, ['x.css:1 .a { border-radius: 9px }']);
});
