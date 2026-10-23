import test from 'node:test';
import assert from 'node:assert/strict';
import { newRoom, reduce, viewForPlayer, viewForScreen } from '../public/js/room.js';
import { roleList, failsNeeded, QUEST_SIZES, HOUSE_DEFAULTS } from '../public/js/rules.js';

const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const must = (r) => { assert.ok(r.ok, r.error); return r; };
const act = (room, id, msg, rng, now) => reduce(room, { playerId: id }, msg, rng, now);

function lobby(n, { settings = { merlin: true }, house = {}, mode } = {}) {
  const rng = seeded(3); const room = newRoom('ABCDEF', 'hk'); const ids = [];
  for (let i = 0; i < n; i++) ids.push(must(reduce(room, {}, { type: 'join', name: `P${i}`, hostKey: i === 0 ? 'hk' : undefined }, rng)).data.playerId);
  const host = ids[0];
  must(act(room, host, { type: 'settings', settings }));
  if (Object.keys(house).length) must(act(room, host, { type: 'house', house }));
  if (mode) must(act(room, host, { type: 'mode', mode }));
  return { room, ids, host, rng };
}
function started(n, opts) {
  const t = lobby(n, opts);
  must(act(t.room, t.host, { type: 'start' }, t.rng));
  for (const id of t.ids) if (t.room.phase === 'reveal') act(t.room, id, { type: 'ready' });
  if (t.room.phase === 'reveal') must(act(t.room, t.host, { type: 'skipReveal' }));
  return t;
}
const leader = (room) => viewForPlayer(room, room.players[0].id).game.leader;
const sideOf = (room, id) => (['assassin', 'morgana', 'mordred', 'oberon', 'minion'].includes(room.game.roles[id]) ? 'evil' : 'good');

test('hammerAuto is gone from the house rules', () => {
  assert.ok(!('hammerAuto' in HOUSE_DEFAULTS));
  const t = lobby(5);
  must(act(t.room, t.host, { type: 'house', house: { hammerAuto: true } }));
  assert.ok(!('hammerAuto' in t.room.house));
});

test('host overrides only work when the matching piece is physical', () => {
  const t = started(5, { mode: { play: 'hybrid', roles: 'app', votes: 'app', cards: 'app' } });
  must(act(t.room, leader(t.room), { type: 'propose', team: t.ids.slice(0, 2) }));
  assert.ok(act(t.room, t.host, { type: 'tally', approve: t.ids }).error, 'app votes cannot be overridden');
  for (const id of t.ids) must(act(t.room, id, { type: 'vote', approve: true }));
  assert.equal(t.room.phase, 'quest');
  assert.ok(act(t.room, t.host, { type: 'questResult', fails: 0 }).error, 'app cards cannot be overridden');
  const p = started(5, { mode: { play: 'hybrid', roles: 'app', votes: 'physical', cards: 'app' } });
  must(act(p.room, leader(p.room), { type: 'propose', team: p.ids.slice(0, 2) }));
  must(act(p.room, p.host, { type: 'tally', approve: p.ids }));
  assert.ok(act(p.room, p.host, { type: 'questResult', fails: 0 }).error, 'cards still in the app');
});

test('Percival without Merlin is a setup error', () => {
  assert.match(roleList(7, { merlin: false, percival: true }).error, /Percival needs Merlin/);
  assert.ok(roleList(7, { merlin: true, percival: true }).roles);
  const t = lobby(7, { settings: { merlin: false, percival: true } });
  const r = act(t.room, t.host, { type: 'start' }, t.rng);
  assert.match(r.error, /Percival needs Merlin/);
  assert.equal(t.room.phase, 'lobby');
});

test('Assassin phase: only Evil players see the Evil team, not Good or the screen', () => {
  const t = started(5);
  t.room.phase = 'assassin';
  for (const id of t.ids) {
    const g = viewForPlayer(t.room, id).game;
    if (sideOf(t.room, id) === 'evil') { assert.equal(g.evil.length, 2); assert.ok(g.assassin); }
    else { assert.equal(g.evil, undefined); assert.equal(g.assassin, undefined); }
  }
  const s = viewForScreen(t.room).game;
  assert.equal(s.evil, undefined); assert.equal(s.assassin, undefined);
});

test('leader moves on by one after a completed quest and rejects reset', () => {
  const t = started(5);
  const first = leader(t.room);
  must(act(t.room, first, { type: 'propose', team: t.ids.slice(0, QUEST_SIZES[5][0]) }));
  for (const id of t.ids) must(act(t.room, id, { type: 'vote', approve: false }));
  assert.equal(t.room.game.rejects, 1);
  const second = leader(t.room);
  assert.notEqual(second, first);
  const team = t.ids.slice(0, QUEST_SIZES[5][0]);
  must(act(t.room, second, { type: 'propose', team }));
  for (const id of t.ids) must(act(t.room, id, { type: 'vote', approve: true }));
  for (const id of team) must(act(t.room, id, { type: 'play', sabotage: false }));
  assert.equal(t.room.game.rejects, 0);
  const ids = t.room.players.map((p) => p.id);
  assert.equal(leader(t.room), ids[(ids.indexOf(second) + 1) % 5]);
});

test('quest 4 needs two fails from 7 players up, one below', () => {
  for (const n of [5, 6]) assert.equal(failsNeeded(n, 3), 1);
  for (const n of [7, 8, 9, 10]) assert.equal(failsNeeded(n, 3), 2);
  const t = started(8, { mode: { play: 'physical' } });
  t.room.game.quest = 3; t.room.game.results = ['success', 'fail', 'success'];
  must(act(t.room, t.host, { type: 'propose', team: t.ids.slice(0, QUEST_SIZES[8][3]) }));
  must(act(t.room, t.host, { type: 'tally', approve: t.ids }));
  must(act(t.room, t.host, { type: 'questResult', fails: 1 }));
  assert.equal(t.room.game.results[3], 'success', 'one fail is not enough at 8 players');
});
