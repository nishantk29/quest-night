import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, EVIL_COUNT, QUEST_SIZES, failsNeeded, roleList, knowledgeFor, proposalPasses, questWinner, shuffle } from '../public/js/rules.js';

const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const count = (arr, f) => arr.filter(f).length;

test('side sizes per table size', () => {
  const want = { 5: [3, 2], 6: [4, 2], 7: [4, 3], 8: [5, 3], 9: [6, 3], 10: [6, 4] };
  for (const [n, [good, evil]] of Object.entries(want)) {
    const { roles } = roleList(+n, { merlin: true });
    assert.equal(roles.length, +n);
    assert.equal(count(roles, (r) => ROLES[r].side === 'good'), good, `good at ${n}`);
    assert.equal(count(roles, (r) => ROLES[r].side === 'evil'), evil, `evil at ${n}`);
    assert.equal(EVIL_COUNT[n], evil);
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

test('optional roles appear when switched on, Merlin brings the Assassin', () => {
  const all = { merlin: true, percival: true, morgana: true, mordred: true, oberon: true };
  const r10 = roleList(10, all).roles;
  for (const id of ['merlin', 'percival', 'assassin', 'morgana', 'mordred', 'oberon']) assert.ok(r10.includes(id), id);
  assert.equal(count(r10, (r) => r === 'minion'), 0);
  assert.ok(roleList(5, all).error, '5 players have only 2 evil seats');
  const plain = roleList(5, { merlin: false }).roles;
  assert.ok(!plain.includes('merlin') && !plain.includes('assassin'));
  assert.deepEqual([...roleList(5, { merlin: true }).roles].sort(), ['assassin', 'merlin', 'minion', 'servant', 'servant']);
});

test('who sees whom', () => {
  const roles = { a: 'merlin', b: 'percival', c: 'servant', d: 'assassin', e: 'morgana', f: 'mordred', g: 'oberon', h: 'minion', i: 'servant', j: 'servant' };
  const ids = (p) => knowledgeFor(p, roles).map((x) => x.id).sort();
  assert.deepEqual(ids('a'), ['d', 'e', 'g', 'h'], 'Merlin sees evil but not Mordred');
  assert.deepEqual(ids('b'), ['a', 'e'], 'Percival sees Merlin and Morgana');
  assert.ok(knowledgeFor('b', roles).every((x) => x.tag === 'merlin?'));
  assert.deepEqual(ids('c'), []);
  for (const s of ['d', 'e', 'f', 'h']) assert.deepEqual(ids(s), ['d', 'e', 'f', 'h'].filter((x) => x !== s), `${s} sees evil minus Oberon`);
  assert.deepEqual(ids('g'), [], 'Oberon sees nobody');
});

test('proposal needs a strict majority', () => {
  assert.equal(proposalPasses(3, 5), true);
  assert.equal(proposalPasses(2, 5), false);
  assert.equal(proposalPasses(3, 6), false, 'a tie rejects');
  assert.equal(proposalPasses(4, 6), true);
});

test('quest winner', () => {
  assert.equal(questWinner(['success', 'fail', 'success']), null);
  assert.equal(questWinner(['success', 'fail', 'success', 'success']), 'good');
  assert.equal(questWinner(['fail', 'fail', 'success', 'fail']), 'evil');
});

test('shuffle keeps every item', () => {
  const r = seeded(7);
  for (let i = 0; i < 50; i++) assert.deepEqual(shuffle([1, 2, 3, 4, 5], r).sort(), [1, 2, 3, 4, 5]);
});

test('exactly what each Avalon role knows', () => {
  const roles = { mer: 'merlin', per: 'percival', ser: 'servant', ass: 'assassin', mor: 'morgana', mdr: 'mordred', obe: 'oberon', min: 'minion', s2: 'servant', s3: 'servant' };
  const k = (p) => Object.fromEntries(knowledgeFor(p, roles).map((x) => [x.id, x.tag]));
  // Merlin: every evil player except Mordred, Oberon included, all tagged evil
  assert.deepEqual(k('mer'), { ass: 'evil', mor: 'evil', obe: 'evil', min: 'evil' });
  // Percival: Merlin and Morgana under the same tag, so he cannot tell which is which
  assert.deepEqual(k('per'), { mer: 'merlin?', mor: 'merlin?' });
  // Evil other than Oberon: each other, Mordred and Morgana included, never Oberon, never themselves
  assert.deepEqual(k('ass'), { mor: 'evil', mdr: 'evil', min: 'evil' });
  assert.deepEqual(k('mor'), { ass: 'evil', mdr: 'evil', min: 'evil' });
  assert.deepEqual(k('mdr'), { ass: 'evil', mor: 'evil', min: 'evil' });
  assert.deepEqual(k('min'), { ass: 'evil', mor: 'evil', mdr: 'evil' });
  // Oberon sees nobody; Loyal Servants see nobody
  assert.deepEqual(k('obe'), {});
  for (const p of ['ser', 's2', 's3']) assert.deepEqual(k(p), {});
  // Without Morgana Percival sees Merlin alone
  assert.deepEqual(knowledgeFor('per', { per: 'percival', mer: 'merlin', a: 'servant', b: 'assassin', c: 'minion' }).map((x) => x.id), ['mer']);
});
