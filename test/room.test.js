import test from 'node:test';
import assert from 'node:assert/strict';
import { newRoom, reduce, viewForPlayer } from '../public/js/room.js';
import { ROLES, QUEST_SIZES } from '../public/js/rules.js';

const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

function table(n, settings = { seer: true }, seed = 1) {
  const rng = seeded(seed);
  const room = newRoom('ABCDEF', 'hk');
  const ids = [];
  for (let i = 0; i < n; i++) {
    const r = reduce(room, { anon: true }, { type: 'join', name: `P${i}`, hostKey: i === 0 ? 'hk' : undefined }, rng);
    assert.ok(r.ok, r.error);
    ids.push(r.data.playerId);
  }
  const host = { playerId: ids[0] };
  assert.ok(reduce(room, host, { type: 'settings', settings }).ok);
  assert.ok(reduce(room, host, { type: 'start' }, rng).ok);
  for (const id of ids) reduce(room, { playerId: id }, { type: 'ready' });
  assert.equal(room.phase, 'propose');
  return { room, ids, rng, host };
}
const act = (room, id, msg) => reduce(room, { playerId: id }, msg);
const must = (r) => { assert.ok(r.ok, r.error); return r; };
const leader = (room) => viewForPlayer(room, room.players[0].id).game.leader;
const side = (room, id) => ROLES[room.game.roles[id]].side;

function proposeAndVote(room, ids, team, approve) {
  must(act(room, leader(room), { type: 'propose', team }));
  for (const id of ids) must(act(room, id, { type: 'vote', approve: approve(id) }));
}

test('first player with the host key becomes host; others cannot', () => {
  const room = newRoom('ABCDEF', 'hk');
  const a = reduce(room, {}, { type: 'join', name: 'A', hostKey: 'hk' }).data.playerId;
  const b = reduce(room, {}, { type: 'join', name: 'B', hostKey: 'hk' }).data.playerId;
  assert.equal(room.players.find((p) => p.id === a).host, true);
  assert.equal(room.players.find((p) => p.id === b).host, false);
  assert.ok(reduce(room, { playerId: b }, { type: 'start' }).error);
  assert.ok(reduce(room, {}, { type: 'join', name: 'a' }).error, 'duplicate names refused');
});

test('cannot start under 5, roles dealt for every table size', () => {
  for (let n = 4; n <= 10; n++) {
    const room = newRoom('ABCDEF', 'hk');
    const ids = [];
    for (let i = 0; i < n; i++) ids.push(reduce(room, {}, { type: 'join', name: `P${i}`, hostKey: i ? undefined : 'hk' }).data.playerId);
    const r = reduce(room, { playerId: ids[0] }, { type: 'start' }, seeded(n));
    if (n < 5) { assert.ok(r.error); continue; }
    assert.ok(r.ok);
    assert.equal(Object.keys(room.game.roles).length, n);
    assert.deepEqual(room.game.sizes, QUEST_SIZES[n]);
  }
});

test('leader must pick exactly the quest size', () => {
  const { room, ids } = table(5);
  const L = leader(room);
  assert.ok(act(room, L, { type: 'propose', team: ids.slice(0, 3) }).error);
  const other = ids.find((x) => x !== L);
  assert.ok(act(room, other, { type: 'propose', team: ids.slice(0, 2) }).error, 'only the leader');
  must(act(room, L, { type: 'pick', id: ids[0] }));
  must(act(room, L, { type: 'pick', id: ids[1] }));
  assert.ok(act(room, L, { type: 'pick', id: ids[2] }).error, 'over size');
  must(act(room, L, { type: 'propose' }));
  assert.equal(room.phase, 'vote');
});

test('rejected proposal passes leadership on; five rejects hand the Shadow the game', () => {
  const { room, ids } = table(5);
  for (let k = 1; k <= 5; k++) {
    const before = leader(room);
    proposeAndVote(room, ids, ids.slice(0, 2), () => false);
    if (k < 5) { assert.equal(room.phase, 'propose'); assert.notEqual(leader(room), before); assert.equal(room.game.rejects, k); }
  }
  assert.equal(room.phase, 'over');
  assert.equal(room.game.winner, 'shadow');
  assert.equal(room.game.reason, 'rejects');
});

test('a tie rejects; votes are hidden until everyone votes', () => {
  const { room, ids } = table(6);
  must(act(room, leader(room), { type: 'propose', team: ids.slice(0, 2) }));
  must(act(room, ids[0], { type: 'vote', approve: true }));
  assert.ok(act(room, ids[0], { type: 'vote', approve: false }).error, 'no double vote');
  const v = viewForPlayer(room, ids[1]);
  assert.deepEqual(v.game.voted, [ids[0]]);
  assert.equal(JSON.stringify(v).includes('"approve":true'), false);
  for (const id of ids.slice(1)) must(act(room, id, { type: 'vote', approve: ids.indexOf(id) < 3 }));
  assert.equal(room.game.lastVote.passed, false);
  assert.equal(room.game.lastVote.approve.length, 3);
});

test('loyal cannot sabotage; one sabotage fails a normal quest', () => {
  const { room, ids } = table(5);
  const loyal = ids.filter((id) => side(room, id) === 'loyal');
  const shadow = ids.filter((id) => side(room, id) === 'shadow');
  proposeAndVote(room, ids, [loyal[0], shadow[0]], () => true);
  assert.equal(room.phase, 'quest');
  assert.ok(act(room, loyal[0], { type: 'play', sabotage: true }).error);
  assert.ok(act(room, loyal[1], { type: 'play', sabotage: false }).error, 'not on the team');
  must(act(room, loyal[0], { type: 'play', sabotage: false }));
  must(act(room, shadow[0], { type: 'play', sabotage: true }));
  assert.deepEqual(room.game.results, ['fail']);
  assert.equal(room.game.lastQuest.fails, 1);
  assert.equal(room.game.rejects, 0);
});

test('quest 4 at 7 players survives one sabotage', () => {
  const { room, ids } = table(7);
  const loyal = ids.filter((id) => side(room, id) === 'loyal');
  const shadow = ids.filter((id) => side(room, id) === 'shadow');
  const runQuest = (team, sab) => { proposeAndVote(room, ids, team, () => true); for (const id of team) must(act(room, id, { type: 'play', sabotage: sab.includes(id) })); };
  runQuest(loyal.slice(0, 2), []);
  runQuest([...loyal.slice(0, 2), shadow[0]], [shadow[0]]);
  runQuest(loyal.slice(0, 3), []); // quest sizes at 7: 2,3,3,4,4
  assert.deepEqual(room.game.results, ['success', 'fail', 'success']);
  runQuest([...loyal.slice(0, 3), shadow[0]], [shadow[0]]);
  assert.equal(room.game.results[3], 'success', 'one sabotage is not enough on quest 4');
  assert.equal(room.phase, 'assassin');
});

test('assassin: naming the Seer wins for the Shadow, missing wins for the Loyal', () => {
  for (const hit of [true, false]) {
    const { room, ids } = table(5, { seer: true }, hit ? 3 : 4);
    const loyal = ids.filter((id) => side(room, id) === 'loyal');
    const sizes = room.game.sizes;
    for (let q = 0; q < 3; q++) {
      const team = loyal.slice(0, sizes[q]);
      proposeAndVote(room, ids, team, () => true);
      for (const id of team) must(act(room, id, { type: 'play', sabotage: false }));
    }
    assert.equal(room.phase, 'assassin');
    const assassin = ids.find((id) => room.game.roles[id] === 'assassin');
    const seer = ids.find((id) => room.game.roles[id] === 'seer');
    const knight = ids.find((id) => room.game.roles[id] === 'knight');
    assert.ok(act(room, knight, { type: 'strike', id: seer }).error, 'only the assassin strikes');
    must(act(room, assassin, { type: 'strike', id: hit ? seer : knight }));
    assert.equal(room.game.winner, hit ? 'shadow' : 'loyal');
    assert.equal(viewForPlayer(room, ids[0]).game.roles[seer].id, 'seer', 'roles revealed at the end');
  }
});

test('without the Seer, three successes end the game for the Loyal', () => {
  const { room, ids } = table(5, { seer: false });
  const loyal = ids.filter((id) => side(room, id) === 'loyal');
  for (let q = 0; q < 3; q++) {
    const team = loyal.slice(0, room.game.sizes[q]);
    proposeAndVote(room, ids, team, () => true);
    for (const id of team) must(act(room, id, { type: 'play', sabotage: false }));
  }
  assert.equal(room.phase, 'over');
  assert.equal(room.game.winner, 'loyal');
});

test('three failed quests win for the Shadow', () => {
  const { room, ids } = table(5);
  const shadow = ids.filter((id) => side(room, id) === 'shadow');
  const loyal = ids.filter((id) => side(room, id) === 'loyal');
  for (let q = 0; q < 3; q++) {
    const team = [shadow[0], ...loyal].slice(0, room.game.sizes[q]);
    proposeAndVote(room, ids, team, () => true);
    for (const id of team) must(act(room, id, { type: 'play', sabotage: id === shadow[0] }));
  }
  assert.equal(room.game.winner, 'shadow');
  assert.equal(room.game.reason, 'quests');
});

test('secrecy: a player view holds only their own role and their own knowledge', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { room, ids } = table(10, { seer: true, herald: true, enchantress: true, usurper: true }, seed);
    for (const id of ids) {
      const v = viewForPlayer(room, id);
      const s = JSON.stringify(v);
      assert.equal(v.me.role.id, room.game.roles[id]);
      assert.equal(v.game.roles, undefined);
      assert.equal(s.includes('token'), false);
      assert.equal(s.includes('hk'), false, 'host key never sent');
      // no other player's role name anywhere
      for (const other of ids) if (other !== id && room.game.roles[other] !== room.game.roles[id]) {
        assert.equal(s.includes(`"${room.game.roles[other]}"`) && !v.game.roleSet.includes(room.game.roles[other]), false);
      }
      for (const k of v.me.sees) assert.ok(['shadow', 'seer?'].includes(k.tag));
    }
  }
});

test('secrecy: quest cards never leave the room', () => {
  const { room, ids } = table(5);
  proposeAndVote(room, ids, ids.slice(0, 2), () => true);
  must(act(room, ids[0], { type: 'play', sabotage: false }));
  const v = viewForPlayer(room, ids[2]);
  assert.deepEqual(v.game.played, [ids[0]]);
  assert.equal(/"cards":\{/.test(JSON.stringify(v)), false);
});

test('play again keeps the table and returns to the lobby', () => {
  const { room, ids, host } = table(5);
  for (let k = 0; k < 5; k++) proposeAndVote(room, ids, ids.slice(0, 2), () => false);
  must(reduce(room, host, { type: 'again' }));
  assert.equal(room.phase, 'lobby');
  assert.equal(room.players.length, 5);
});
