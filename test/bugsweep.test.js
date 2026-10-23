import test from 'node:test';
import assert from 'node:assert/strict';
import { newRoom, reduce } from '../public/js/room.js';
import { fanout } from '../src/fanout.js';

const join = (room, name, hostKey) => reduce(room, {}, { type: 'join', name, hostKey }).data.playerId;
const sock = (att) => { const got = []; return { att, got, ws: { send: (m) => got.push(JSON.parse(m)) } }; };

test('a player removed by the host gets a clearing fatal instead of a view with me = null', () => {
  const room = newRoom('ABCDEF', 'hk');
  const a = join(room, 'A', 'hk'); const b = join(room, 'B');
  const sa = sock({ who: 'player', playerId: a }); const sb = sock({ who: 'player', playerId: b });
  let att = sb.att; sb.ws.serializeAttachment = (x) => { att = x; };
  assert.ok(reduce(room, { playerId: a }, { type: 'kick', id: b }).ok);
  fanout(room, [sa, { ws: sb.ws, att }], new Set([a, b]));
  assert.equal(sb.got.length, 1);
  assert.deepEqual([sb.got[0].type, sb.got[0].clear], ['fatal', true]);
  assert.equal(att.who, null, 'the dead attachment is dropped');
  assert.equal(sa.got[0].view.me.id, a);
});

test('play again: late watchers are seated again for the next game', () => {
  const room = newRoom('ABCDEF', 'hk');
  const ids = ['A', 'B', 'C', 'D', 'E'].map((n, i) => join(room, n, i ? undefined : 'hk'));
  assert.ok(reduce(room, { playerId: ids[0] }, { type: 'start' }).ok);
  const w = join(room, 'Late');
  assert.equal(room.players.find((p) => p.id === w).watch, true);
  room.phase = 'over';
  assert.ok(reduce(room, { playerId: ids[0] }, { type: 'again' }).ok);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.players.find((p) => p.id === w).watch, false);
  assert.equal(room.players.filter((p) => !p.watch).length, 6);
});
