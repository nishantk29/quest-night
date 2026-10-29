// The FAQ's numbers come from rules.js, and its answers match what the room does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FAQ } from '../public/js/faq.js';
import { EVIL_COUNT, MIN_PLAYERS, MAX_PLAYERS, MAX_REJECTS, failsNeeded, proposalPasses } from '../public/js/rules.js';

const qa = Object.fromEntries(FAQ.flatMap(([, qs]) => qs).map(([q, a]) => [q, a.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()]));
const find = (re) => Object.entries(qa).find(([q]) => re.test(q))?.[1] || '';

test('FAQ majority per table size matches proposalPasses', () => {
  const a = find(/tied vote/);
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    let need = 0; while (!proposalPasses(need, n)) need++;
    assert.match(a, new RegExp(`${need} of [^,)]*\\b${n}\\b`), `${n} players need ${need}`);
  }
});

test('FAQ Evil seats per table size match EVIL_COUNT', () => {
  const a = find(/Custom role mixes/);
  for (const [n, e] of Object.entries(EVIL_COUNT)) assert.match(a, new RegExp(`${e} at [0-9–]*`), `${n}: ${e}`);
  assert.ok(a.includes(`${MIN_PLAYERS} to ${MAX_PLAYERS} players`));
});

test('FAQ rejection limit and quest-4 rule match rules.js', () => {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
  assert.ok(find(/rejected parties/).toLowerCase().startsWith(`${words[MAX_REJECTS]} rejected parties`));
  const from = [5, 6, 7, 8, 9, 10].find((n) => failsNeeded(n, 3) === 2);
  assert.ok(find(/quest 4/).startsWith(`At ${from} or more players`));
});

test('FAQ: the Assassin may name any other player (room refuses only themselves)', () => {
  assert.match(find(/Assassin strike/), /names one player/);
  assert.doesNotMatch(find(/Assassin strike/), /one Loyal player/);
});
