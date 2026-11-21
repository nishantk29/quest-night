// scripts/sim-games.mjs helpers: knowledge is compared as a set (the server uses the game's hidden order), and the
// sim never asks for Percival without Merlin (the server rightly refuses that deal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sameKnowledge, rollSettings } from '../scripts/sim-games.mjs';
import { knowledgeFor } from '../public/js/rules.js';

test('sim: knowledge matches in any order, and a different list still fails', () => {
  const roles = { a: 'merlin', b: 'assassin', c: 'servant', d: 'morgana', e: 'servant' };
  const seat = knowledgeFor('a', roles), hidden = knowledgeFor('a', roles, ['e', 'd', 'c', 'b', 'a']);
  assert.notDeepEqual(seat, hidden, 'the two orders really differ');
  assert.ok(sameKnowledge(hidden, seat));
  assert.ok(!sameKnowledge(hidden.slice(1), seat));
  assert.ok(!sameKnowledge([{ id: 'b', tag: 'merlin?' }, { id: 'd', tag: 'evil' }], seat), 'a wrong tag fails');
  assert.ok(sameKnowledge([], []));
});

test('sim: Percival is only rolled when Merlin is on', () => {
  let percival = 0;
  for (let i = 0; i < 2000; i++) { const s = rollSettings(); assert.ok(!s.percival || s.merlin); percival += s.percival; }
  assert.ok(percival > 200, 'Percival still comes up');
});

test('sim: start waits on the server answer, no fixed sleeps around settings and start', () => {
  const src = fs.readFileSync(new URL('../scripts/sim-games.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /type: 'start' \}\);\s*await sleep/);
  assert.doesNotMatch(src, /type: 'settings'[^\n]*\}\);?\s*await sleep/);
  assert.match(src, /host\.errors/);
});
