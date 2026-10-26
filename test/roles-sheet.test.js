// "Roles in this game": static, the same for every viewer, built from ROLES + roleList.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rolesInGame, rolesSeats, rolesSheetBody } from '../public/js/roles_sheet.js';
import { newRoom, reduce, viewForPlayer, viewForScreen } from '../public/js/room.js';
import { roleList, ROLES, MIN_PLAYERS, MAX_PLAYERS } from '../public/js/rules.js';

const FULL = { merlin: true, percival: true, morgana: true, mordred: true, oberon: true };
const glyph = (n) => `<i>${n}</i>`; const esc = (s) => String(s);

test('counts sum to the seat count and match the deal, at every table size and setup', () => {
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    for (const s of [{ merlin: true }, { merlin: false }, { merlin: true, percival: true, morgana: true }, FULL]) {
      const list = roleList(n, s); const info = rolesInGame(n, s);
      if (list.error) { assert.equal(info.error, list.error); continue; }
      const total = info.groups.flatMap((g) => g.roles).reduce((a, r) => a + r.count, 0);
      assert.equal(total, n);
      const dealt = {}; for (const id of list.roles) dealt[id] = (dealt[id] || 0) + 1;
      for (const g of info.groups) {
        assert.equal(g.count, g.roles.reduce((a, r) => a + r.count, 0));
        for (const r of g.roles) { assert.equal(r.count, dealt[r.id]); assert.equal(ROLES[r.id].side, g.side); assert.ok(r.blurb && r.name && r.icon); }
      }
      assert.deepEqual(info.groups.map((g) => g.side), ['good', 'evil']);
    }
  }
});

test('Percival and Morgana say Percival sees two candidates; without Morgana, only Merlin', () => {
  const withM = rolesInGame(7, { merlin: true, percival: true, morgana: true }).groups.flatMap((g) => g.roles);
  assert.match(withM.find((r) => r.id === 'percival').note, /two players/);
  assert.match(withM.find((r) => r.id === 'morgana').note, /second Merlin/);
  const without = rolesInGame(7, { merlin: true, percival: true }).groups.flatMap((g) => g.roles);
  assert.match(without.find((r) => r.id === 'percival').note, /sees Merlin/);
});

test('the lobby shows the planned setup even with too few players; invalid setups say why', () => {
  assert.equal(rolesInGame(2, { merlin: true }).seats, MIN_PLAYERS);
  assert.equal(rolesInGame(2, { merlin: true }).groups.length, 2);
  assert.match(rolesInGame(5, { merlin: true, morgana: true, mordred: true }).error, /Evil seats/);
});

function started(n = 7, settings = { merlin: true, percival: true, morgana: true }) {
  const room = newRoom('ABCDEF', 'hk'); const ids = [];
  for (let i = 0; i < n; i++) ids.push(reduce(room, { anon: true }, { type: 'join', name: `Zed${i}`, hostKey: i === 0 ? 'hk' : undefined }).data.playerId);
  reduce(room, { playerId: ids[0] }, { type: 'settings', settings });
  return { room, ids };
}

test('identical for every viewer and every phase; never names a player or an id; no alive/out markers', () => {
  const { room, ids } = started();
  const sheet = (v) => JSON.stringify(rolesInGame(rolesSeats(v), v.settings));
  const lobby = sheet(viewForScreen(room));
  assert.equal(lobby, sheet(viewForPlayer(room, ids[1])));
  assert.ok(reduce(room, { playerId: ids[0] }, { type: 'start' }).ok);
  const first = sheet(viewForScreen(room));
  assert.equal(first, lobby, 'the dealt setup is the planned one');
  for (const phase of ['reveal', 'propose', 'vote', 'quest', 'assassin', 'over']) {
    room.phase = phase;
    const views = [viewForScreen(room), ...ids.map((id) => viewForPlayer(room, id))];
    for (const v of views) assert.equal(sheet(v), first, `${phase}`);
  }
  const html = rolesSheetBody(rolesInGame(7, room.settings), esc, glyph);
  for (const id of ids) assert.equal(html.includes(`"${id}"`), false);
  assert.equal(/Zed\d/.test(html + first), false);
  assert.equal(/alive|out\b|dead|eliminated/i.test(html), false);
});

test('a watcher or screen joining mid-game sees the same dealt setup', () => {
  const { room, ids } = started(6, { merlin: true });
  reduce(room, { playerId: ids[0] }, { type: 'start' });
  const late = reduce(room, null || { anon: true }, { type: 'join', name: 'Late' }).data.playerId;
  const v = viewForPlayer(room, late);
  assert.equal(rolesSeats(v), 6);
  assert.deepEqual(rolesInGame(rolesSeats(v), v.settings), rolesInGame(6, { merlin: true }));
});
