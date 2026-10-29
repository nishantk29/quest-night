// One label per intent (Nishant approved 2026-10-29 6:03 PM ET; run/copy/label-list.md; DESIGN-SKILL §10).
// kit/labels.mjs is a copy of /workspace/code-team/shared/copy-lint/labels.mjs (copy it, don't fork it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintLabel, extractLabels, lintLiteral } from './kit/labels.mjs';

const PUB = fileURLToPath(new URL('../public/', import.meta.url));
// Words that may be capitalised inside a label: game, place and role names.
const PROPER = ["Quest", "Night", "Game", "Merlin", "Lantern", "Assassin", "Mordred", "Percival", "Morgana", "Oberon", "Approve", "Reject", "Success", "Sabotage", "Evil", "Good"];
// Strings that are not plain labels: keyboard keys, data values, prose, and named house rules.
const NOT_LABELS = new Set([]);
const SKIP_DIRS = new Set(['vendor', 'fonts', 'icons', 'art', 'img']);
function shipped(dir = PUB) {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); if (statSync(p).isDirectory()) return SKIP_DIRS.has(f) ? [] : shipped(p); return /\.(js|html)$/.test(f) && f !== 'sw.js' ? [p] : []; });
}
const rel = (p) => p.slice(PUB.length);
const src = (p) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

test('labels: every visible button label uses the one phrasing for its intent, in sentence case', () => {
  const hits = shipped().flatMap((p) => extractLabels(src(p)).filter((l) => !NOT_LABELS.has(`${rel(p)}|${l}`)).flatMap((l) => lintLabel(l, { proper: PROPER }).map((i) => `${rel(p)}: ${i}`)));
  assert.deepEqual([...new Set(hits)], []);
});
test('labels: no banned variant reaches a button through a string literal', () => {
  const hits = [];
  for (const p of shipped()) for (const m of src(p).matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\$]|\\.)*)`/g)) {
    const s = m[1] ?? m[2] ?? m[3]; if (NOT_LABELS.has(`${rel(p)}|${s}`)) continue;
    hits.push(...lintLiteral(s).map((i) => `${rel(p)}: ${i}`));
  }
  assert.deepEqual([...new Set(hits)], []);
});
test('labels: the lint is live (each banned variant fails, the approved labels pass)', () => {
  for (const bad of ['Begin Game', 'Got it', 'Nobody', 'Not Now', 'Yes, end game', 'Confirm', 'Open Table', 'Open Chamber', 'Continue', 'Restart now', 'Show QR', 'Undo last step', 'Take a Seat', 'Join Room', 'I’m Ready', 'Shuffle Seats'])
    assert.ok(lintLabel(bad).length > 0, bad);
  for (const ok of ['Host a game', 'Join a game', 'Join', 'Next: Seating', 'Deal 6 roles', 'Start night 1', 'I’m ready', 'See my role', 'Reveal', 'Close', 'Done', 'Back', 'Not now', 'Cancel', 'Keep playing', 'Restart game', 'End game', 'Leave game', 'No one', 'Skip', 'Show QR code', 'Copy link', 'Save preset', 'Undo', 'Full screen', 'Play again', 'All games', 'Go to Game Night home'])
    assert.deepEqual(lintLabel(ok, { proper: ['Game', 'Night'] }), [], ok);
  assert.deepEqual(lintLiteral('Nobody died last night.'), []);
  assert.deepEqual(extractLabels('<button class="btn" data-a="x">${ui("eye")} Begin Game</button>'), ['Begin Game']);
});
