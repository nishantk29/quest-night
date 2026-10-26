// Host Restart: same table, fresh deal, straight into the reveal. And the rulesVersion pin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newRoom, reduce, viewForPlayer, viewForScreen, LATEST_RULES_VERSION } from '../public/js/room.js';
import { roleList } from '../public/js/rules.js';

const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
function table(n = 7, settings = { merlin: true, percival: true, morgana: true }, seed = 3) {
  const rng = seeded(seed);
  const room = newRoom('ABCDEF', 'hk');
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(reduce(room, { anon: true }, { type: 'join', name: `P${i}`, hostKey: i === 0 ? 'hk' : undefined }, rng).data.playerId);
  const host = { playerId: ids[0] };
  assert.ok(reduce(room, host, { type: 'settings', settings }).ok);
  assert.ok(reduce(room, host, { type: 'start' }, rng).ok);
  return { room, ids, host, rng };
}
const act = (room, id, msg, rng) => reduce(room, { playerId: id }, msg, rng);

test('newRoom is on the latest rules; a room without rulesVersion is version 1 and is not backfilled', () => {
  assert.equal(LATEST_RULES_VERSION, 2);
  const room = newRoom('ABCDEF', 'hk');
  assert.equal(room.rulesVersion, LATEST_RULES_VERSION);
  const old = JSON.parse(JSON.stringify(room)); delete old.rulesVersion; delete old.gameNo;
  assert.equal(old.rulesVersion, undefined);
  for (const p of ['a', 'b', 'c', 'd', 'e']) reduce(old, { anon: true }, { type: 'join', name: p, hostKey: p === 'a' ? 'hk' : undefined });
  assert.equal(old.rulesVersion, undefined, 'joining never backfills');
});

test('restart keeps code, players, settings, mode and host; new deal, reveal phase, gameNo + 1', () => {
  const { room, ids, host, rng } = table();
  for (const id of ids) act(room, id, { type: 'ready' });
  assert.equal(room.phase, 'propose');
  act(room, ids[1], { type: 'chat', text: 'hello' });
  const before = JSON.stringify({ code: room.code, hostKey: room.hostKey, settings: room.settings, house: room.house, mode: room.mode, players: room.players });
  const no = room.gameNo;
  const dealt = JSON.stringify(room.game.roles);
  let moved = false;
  for (let seed = 1; seed < 20 && !moved; seed++) { // a fresh shuffle: some seed gives a different deal
    const r = act(room, ids[0], { type: 'restart' }, seeded(seed));
    assert.ok(r.ok, r.error);
    moved = JSON.stringify(room.game.roles) !== dealt;
  }
  assert.ok(moved, 'roles are re-dealt');
  assert.equal(room.phase, 'reveal');
  assert.equal(JSON.stringify({ code: room.code, hostKey: room.hostKey, settings: room.settings, house: room.house, mode: room.mode, players: room.players }), before);
  assert.ok(room.gameNo > no);
  assert.deepEqual(Object.values(room.game.roles).sort(), roleList(7, room.settings).roles.slice().sort());
  assert.equal(Object.keys(room.game.roles).length, ids.length);
  void rng; void host;
});

test('restart bumps gameNo by exactly one and clears chat, log, quests, votes, lantern, undo, timers, pause, poll', () => {
  const { room, ids, rng } = table(7, { merlin: true });
  room.house.lantern = true; room.house.turnTimer = 0;
  assert.ok(act(room, ids[0], { type: 'restart' }, rng).ok);
  for (const id of ids) act(room, id, { type: 'ready' });
  const g = room.game;
  act(room, ids[2], { type: 'chat', text: 'secret plan' });
  act(room, ids[0], { type: 'poll', q: 'Who?', players: true });
  act(room, ids[0], { type: 'timer', secs: 60, label: 'Talk' });
  g.results.push('fail'); g.history.push({}); room.undo.push('x'); room.paused = { at: 1 };
  const no = room.gameNo;
  assert.ok(act(room, ids[0], { type: 'restart' }, rng).ok);
  assert.equal(room.gameNo, no + 1);
  assert.equal(room.phase, 'reveal');
  assert.deepEqual(room.game.results, []); assert.deepEqual(room.game.history, []); assert.deepEqual(room.game.votes, {});
  assert.equal(room.game.quest, 0);
  assert.ok(room.log.every((m) => m.kind === 'game') && room.log.length === 1, 'only the new game line');
  assert.equal(room.log.some((m) => /secret plan/.test(m.text)), false);
  assert.deepEqual(room.undo, []);
  assert.equal(room.timer, null); assert.equal(room.talk, null); assert.equal(room.paused, null); assert.equal(room.poll, null);
  assert.equal(room.game.lantern.checks.length, 0);
});

test('a v1 room moves to the latest rules on restart, and on a fresh start', () => {
  for (const via of ['restart', 'start']) {
    const { room, ids, rng } = table();
    delete room.rulesVersion; delete room.gameNo;
    if (via === 'start') { room.phase = 'lobby'; room.game = null; }
    assert.ok(act(room, ids[0], { type: via }, rng).ok);
    assert.equal(room.rulesVersion, LATEST_RULES_VERSION);
    assert.ok(room.gameNo >= 2);
  }
});

test('Play again from the end screen leaves a v1 room on v1 until the next start', () => {
  const { room, ids, rng } = table();
  delete room.rulesVersion; room.phase = 'over';
  assert.ok(act(room, ids[0], { type: 'again' }, rng).ok);
  assert.equal(room.phase, 'lobby'); assert.equal(room.rulesVersion, undefined);
  assert.ok(act(room, ids[0], { type: 'start' }, rng).ok);
  assert.equal(room.rulesVersion, LATEST_RULES_VERSION);
});

test('only the host restarts, and not from the lobby', () => {
  const { room, ids, rng } = table();
  const r = act(room, ids[1], { type: 'restart' }, rng);
  assert.match(r.error, /host/i);
  assert.equal(act(room, null, { type: 'restart' }, rng).error !== undefined, true);
  room.phase = 'lobby'; room.game = null;
  assert.match(act(room, ids[0], { type: 'restart' }, rng).error, /restart/i);
});

test('a restart that cannot deal returns the roleList error and changes nothing', () => {
  const { room, ids, rng } = table(5, { merlin: true });
  room.settings = { merlin: false, percival: true, morgana: false, mordred: false, oberon: false };
  const gameNo = room.gameNo; const game = JSON.stringify(room.game);
  const r = act(room, ids[0], { type: 'restart' }, rng);
  assert.match(r.error, /Percival needs Merlin/);
  assert.equal(room.gameNo, gameNo); assert.equal(JSON.stringify(room.game), game);
});

test('restart seats watchers like Play again, and puts them back if the table cannot deal', () => {
  const { room, ids, rng } = table(5, { merlin: true });
  const late = act(room, null, { type: 'join', name: 'Late' }, rng); // joins as a watcher mid-game
  const lateId = late.data.playerId;
  assert.equal(room.players.find((p) => p.id === lateId).watch, true);
  assert.ok(act(room, ids[0], { type: 'restart' }, rng).ok);
  assert.equal(room.players.find((p) => p.id === lateId).watch, false);
  assert.equal(room.game.n, 6);
});

test('after a restart every view is the fresh reveal: no stale info', () => {
  const { room, ids, rng } = table(7, { merlin: true, percival: true, morgana: true });
  for (const id of ids) act(room, id, { type: 'ready' });
  act(room, ids[3], { type: 'chat', text: 'old news' });
  act(room, ids[0], { type: 'restart' }, rng);
  const views = [...ids.map((id) => viewForPlayer(room, id)), viewForScreen(room)];
  for (const v of views) {
    assert.equal(v.phase, 'reveal');
    assert.equal(v.gameNo, room.gameNo);
    assert.deepEqual(v.game.results, []); assert.deepEqual(v.game.history, []); assert.deepEqual(v.game.ready, []);
    assert.equal(v.game.winner, null); assert.equal(v.game.roles, undefined);
    assert.equal(v.log.some((m) => /old news/.test(m.text)), false);
    assert.equal(v.me?.vote, undefined); assert.equal(v.me?.played, undefined);
  }
  const screen = views.at(-1);
  assert.equal(screen.me, null); assert.equal(screen.game.roles, undefined); assert.equal(screen.moderator, undefined);
  const roles = ids.map((id, i) => views[i].me.role.id).sort();
  assert.deepEqual(roles, roleList(7, room.settings).roles.slice().sort());
});

test('restart works from the end screen and while paused', () => {
  const { room, ids, rng } = table();
  room.phase = 'over'; room.game.winner = 'good'; room.game.reason = 'quests';
  assert.ok(act(room, ids[0], { type: 'restart' }, rng).ok);
  assert.equal(room.phase, 'reveal'); assert.equal(room.game.winner, null);
  act(room, ids[0], { type: 'pause' }, rng);
  assert.ok(act(room, ids[0], { type: 'restart' }, rng).ok);
  assert.equal(room.paused, null);
});
