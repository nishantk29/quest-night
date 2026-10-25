import test from 'node:test';
import assert from 'node:assert/strict';
import { FAQ, FAQ_COVERS, FAQ_GAME } from '../public/js/faq.js';
import { ROLES } from '../public/js/rules.js';

const text = FAQ.flatMap(([, qs]) => qs.map(([q, a]) => `${q} ${a}`)).join(' ').replace(/<[^>]+>/g, ' ');
const sorted = (a) => [...a].sort();

test('FAQ explains exactly the roles, settings, house rules and modes the game has', () => {
  for (const k of Object.keys(FAQ_GAME)) assert.deepEqual(sorted(FAQ_COVERS[k]), sorted(FAQ_GAME[k]), `FAQ ${k} list drifted from the game`);
});

test('every game role appears in the Roles sections, grouped by side, and nothing else does', () => {
  const sec = (name) => (FAQ.find(([g]) => g === name) || [, []])[1].map(([q]) => q);
  const good = sec('Roles: Loyal Side'); const evil = sec('Roles: Evil Side').filter((q) => !q.endsWith('?'));
  assert.deepEqual(sorted(good), sorted(Object.values(ROLES).filter((r) => r.side === 'good').map((r) => r.name)));
  assert.deepEqual(sorted(evil), sorted(Object.values(ROLES).filter((r) => r.side === 'evil').map((r) => r.name)));
  for (const r of Object.values(ROLES)) assert.ok(text.includes(r.name), `${r.name} missing from FAQ`);
});

test('no filename-style link text and no stale game names in the FAQ', () => {
  assert.ok(!/>[^<]*\.html[^<]*</.test(FAQ.map(([, qs]) => qs.map(([, a]) => a).join('')).join('')), 'link text shows a file name');
  assert.ok(!/Council Night/.test(text));
});
