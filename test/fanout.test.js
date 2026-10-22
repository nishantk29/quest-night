import test from 'node:test';
import assert from 'node:assert/strict';
import { newRoom, reduce } from '../public/js/room.js';
import { ROLES } from '../public/js/rules.js';
import { fanout } from '../src/fanout.js';

const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const sock = (att) => { const got = []; return { att, got, ws: { send: (m) => got.push(JSON.parse(m)) } }; };

test('game over: every connected client (players and the table screen) receives one gameover event', () => {
  const rng = seeded(7); const room = newRoom('ABCDEF', 'hk'); const ids = [];
  for (let i = 0; i < 6; i++) ids.push(reduce(room, {}, { type: 'join', name: `P${i}`, hostKey: i ? undefined : 'hk' }, rng).data.playerId);
  const sockets = [...ids.map((playerId) => sock({ who: 'player', playerId })), sock({ who: 'screen' }), sock({ who: null })];
  const act = (id, msg) => { const was = room.phase === 'over'; const r = reduce(room, { playerId: id }, msg, rng); assert.ok(r.ok, r.error); fanout(room, sockets, new Set(ids), was); return r; };
  act(ids[0], { type: 'settings', settings: { seer: true } });
  act(ids[0], { type: 'start' });
  for (const id of ids) act(id, { type: 'ready' });
  for (let i = 0; i < 5; i++) { // five rejected parties in a row: the Shadow wins
    const view = sockets[0].got.at(-1).view;
    act(view.game.leader, { type: 'propose', team: ids.slice(0, view.game.sizes[view.game.quest]) });
    for (const id of ids) act(id, { type: 'vote', approve: false });
  }
  assert.equal(room.phase, 'over');
  const events = (s) => s.got.filter((m) => m.type === 'gameover');
  for (const s of sockets.slice(0, 7)) {
    assert.equal(events(s).length, 1, 'exactly one gameover per connected client');
    assert.equal(events(s)[0].winner, 'shadow');
    assert.equal(events(s)[0].reason, 'rejects');
    assert.ok(s.got.findIndex((m) => m.type === 'gameover') > s.got.findIndex((m) => m.type === 'view' && m.view.phase === 'over'), 'view arrives first');
  }
  assert.equal(sockets[7].got.length, 0, 'a socket that never said hello gets nothing');
  ids.forEach((id, i) => assert.equal(events(sockets[i])[0].won, ROLES[room.game.roles[id]].side === 'shadow', 'You won / You lost matches the player’s own side'));
  assert.equal(events(sockets[6])[0].won, null, 'the table screen has no won/lost');
  assert.ok(!JSON.stringify(events(sockets[6])).includes('"roles"'), 'the event carries no roles');
  act(ids[0], { type: 'again' }); // later updates do not repeat it
  assert.equal(room.phase, 'lobby');
  assert.equal(room.players.length, 6);
  for (const s of sockets.slice(0, 7)) assert.equal(events(s).length, 1);
});
