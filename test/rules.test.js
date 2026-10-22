import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, SHADOW_COUNT, QUEST_SIZES, failsNeeded, roleList, knowledgeFor, proposalPasses, questWinner, shuffle } from '../public/js/rules.js';

const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const count = (arr, f) => arr.filter(f).length;

test('side sizes per table size', () => {
  const want = { 5: [3, 2], 6: [4, 2], 7: [4, 3], 8: [5, 3], 9: [6, 3], 10: [6, 4] };
  for (const [n, [loyal, shadow]] of Object.entries(want)) {
    const { roles } = roleList(+n, { seer: true });
    assert.equal(roles.length, +n);
    assert.equal(count(roles, (r) => ROLES[r].side === 'loyal'), loyal, `loyal at ${n}`);
    assert.equal(count(roles, (r) => ROLES[r].side === 'shadow'), shadow, `shadow at ${n}`);
    assert.equal(SHADOW_COUNT[n], shadow);
  }
});

test('quest sizes table', () => {
  assert.deepEqual(QUEST_SIZES[5], [2, 3, 2, 3, 3]);
  assert.deepEqual(QUEST_SIZES[6], [2, 3, 4, 3, 4]);
  assert.deepEqual(QUEST_SIZES[7], [2, 3, 3, 4, 4]);
  for (const n of [8, 9, 10]) assert.deepEqual(QUEST_SIZES[n], [3, 4, 4, 5, 5]);
  for (let n = 5; n <= 10; n++) for (const s of QUEST_SIZES[n]) assert.ok(s < n);
});

test('two sabotage cards needed only on quest 4 with 7+ players', () => {
  for (let n = 5; n <= 10; n++) for (let q = 0; q < 5; q++) assert.equal(failsNeeded(n, q), n >= 7 && q === 3 ? 2 : 1, `n=${n} q=${q}`);
});

test('player count limits', () => {
  assert.ok(roleList(4, {}).error);
  assert.ok(roleList(11, {}).error);
  assert.ok(roleList(5, {}).roles);
});

test('optional roles appear when switched on, Seer brings the Assassin', () => {
  const all = { seer: true, herald: true, enchantress: true, usurper: true, outcast: true };
  const r10 = roleList(10, all).roles;
  for (const id of ['seer', 'herald', 'assassin', 'enchantress', 'usurper', 'outcast']) assert.ok(r10.includes(id), id);
  assert.equal(count(r10, (r) => r === 'traitor'), 0);
  assert.ok(roleList(5, all).error, '5 players have only 2 shadow seats');
  const plain = roleList(5, { seer: false }).roles;
  assert.ok(!plain.includes('seer') && !plain.includes('assassin'));
  assert.deepEqual([...roleList(5, { seer: true }).roles].sort(), ['assassin', 'knight', 'knight', 'seer', 'traitor']);
});

test('who sees whom', () => {
  const roles = { a: 'seer', b: 'herald', c: 'knight', d: 'assassin', e: 'enchantress', f: 'usurper', g: 'outcast', h: 'traitor', i: 'knight', j: 'knight' };
  const ids = (p) => knowledgeFor(p, roles).map((x) => x.id).sort();
  assert.deepEqual(ids('a'), ['d', 'e', 'g', 'h'], 'Seer sees shadow but not the Usurper');
  assert.deepEqual(ids('b'), ['a', 'e'], 'Herald sees Seer and Enchantress');
  assert.ok(knowledgeFor('b', roles).every((x) => x.tag === 'seer?'));
  assert.deepEqual(ids('c'), []);
  for (const s of ['d', 'e', 'f', 'h']) assert.deepEqual(ids(s), ['d', 'e', 'f', 'h'].filter((x) => x !== s), `${s} sees shadow minus Outcast`);
  assert.deepEqual(ids('g'), [], 'Outcast sees nobody');
});

test('proposal needs a strict majority', () => {
  assert.equal(proposalPasses(3, 5), true);
  assert.equal(proposalPasses(2, 5), false);
  assert.equal(proposalPasses(3, 6), false, 'a tie rejects');
  assert.equal(proposalPasses(4, 6), true);
});

test('quest winner', () => {
  assert.equal(questWinner(['success', 'fail', 'success']), null);
  assert.equal(questWinner(['success', 'fail', 'success', 'success']), 'loyal');
  assert.equal(questWinner(['fail', 'fail', 'success', 'fail']), 'shadow');
});

test('shuffle keeps every item', () => {
  const r = seeded(7);
  for (let i = 0; i < 50; i++) assert.deepEqual(shuffle([1, 2, 3, 4, 5], r).sort(), [1, 2, 3, 4, 5]);
});
