// Setup steppers: unique characters are 0..1, Servants and Minions fill the rest, live validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupSteppers, stepMessage, STEPPERS } from '../public/js/steppers.js';
import { roleList, cleanSettings, EVIL_COUNT, MIN_PLAYERS, MAX_PLAYERS, ROLES } from '../public/js/rules.js';
import { newRoom, reduce } from '../public/js/room.js';

const row = (m, k) => m.rows.find((r) => r.key === k);

test('every special is 0..1 and the +/- disabled states follow the bounds', () => {
  const m = setupSteppers(7, { merlin: true, percival: false, morgana: false, mordred: false, oberon: false });
  assert.deepEqual(m.rows.map((r) => r.key), STEPPERS.map((s) => s.key));
  for (const r of m.rows) { assert.equal(r.min, 0); assert.equal(r.max, 1); }
  assert.equal(row(m, 'merlin').value, 1);
  assert.equal(row(m, 'merlin').plus.disabled, true); assert.match(row(m, 'merlin').plus.reason, /one/i);
  assert.equal(row(m, 'merlin').minus.disabled, false);
  assert.equal(row(m, 'percival').value, 0);
  assert.equal(row(m, 'percival').minus.disabled, true);
  assert.equal(row(m, 'percival').plus.disabled, false);
});

test('Assassin is tied to Merlin (one row) and Servant/Minion are derived read-only counts', () => {
  assert.equal(STEPPERS.some((s) => s.key === 'assassin'), false);
  assert.deepEqual(STEPPERS.find((s) => s.key === 'merlin').roles, ['merlin', 'assassin']);
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    for (const s of [{ merlin: true }, { merlin: true, percival: true, morgana: true }, { merlin: false }]) {
      const m = setupSteppers(n, s); const list = roleList(n, s);
      if (list.error) continue;
      const [servant, minion] = m.fills;
      assert.equal(servant.id, 'servant'); assert.equal(minion.id, 'minion');
      assert.equal(servant.count, list.roles.filter((r) => r === 'servant').length);
      assert.equal(minion.count, list.roles.filter((r) => r === 'minion').length);
      assert.match(servant.reason, /rest/i); assert.match(minion.reason, /rest/i);
      const total = m.rows.reduce((a, r) => a + r.value * r.roles.length, 0) + servant.count + minion.count;
      assert.equal(total, n);
    }
  }
});

test('validation messages per table size: too many Evil roles, Percival without Merlin', () => {
  const evilOn = { merlin: true, percival: false, morgana: true, mordred: false, oberon: false };
  // 5 and 6 players have 2 Evil seats: Assassin + Morgana fill them, so Mordred and Oberon cannot be added.
  for (const n of [5, 6]) {
    const m = setupSteppers(n, evilOn);
    assert.equal(m.ok, true);
    for (const k of ['mordred', 'oberon']) { assert.equal(row(m, k).plus.disabled, true); assert.match(row(m, k).plus.reason, new RegExp(`${n} players have only 2 Evil seats`)); }
    assert.equal(row(m, 'percival').plus.disabled, false);
  }
  // 7 players have 3: one more is fine, two more are not.
  const m7 = setupSteppers(7, { ...evilOn, mordred: true });
  assert.equal(m7.ok, true); assert.equal(row(m7, 'oberon').plus.disabled, true); assert.match(row(m7, 'oberon').plus.reason, /only 3 Evil seats/);
  assert.equal(setupSteppers(10, { ...evilOn, mordred: true, oberon: true }).ok, true, '10 players take all four');
  // Percival without Merlin
  const nm = setupSteppers(7, { merlin: false });
  assert.equal(row(nm, 'percival').plus.disabled, true); assert.match(row(nm, 'percival').plus.reason, /Percival needs Merlin/);
  const bad = setupSteppers(7, { merlin: false, percival: true });
  assert.equal(bad.ok, false); assert.match(bad.error, /Percival needs Merlin/);
  // Merlin + brings the Assassin; it is allowed whenever there is room
  assert.equal(row(setupSteppers(5, { merlin: false, morgana: true, mordred: true }), 'merlin').plus.disabled, true);
});

test('a disabled + never sends; an allowed tap sends the existing boolean settings message', () => {
  const s = { merlin: true, percival: false, morgana: false, mordred: false, oberon: false };
  assert.deepEqual(stepMessage(7, s, 'percival', 1), { type: 'settings', settings: { percival: true } });
  assert.deepEqual(stepMessage(7, { ...s, percival: true }, 'percival', -1), { type: 'settings', settings: { percival: false } });
  assert.equal(stepMessage(7, s, 'merlin', 1), null);
  assert.equal(stepMessage(7, s, 'percival', -1), null);
  assert.equal(stepMessage(5, { ...s, morgana: true }, 'oberon', 1), null);
  assert.equal(stepMessage(7, s, 'percival', 1, false), null, 'non-hosts cannot change roles');
  // every message cleanSettings accepts as-is
  const msg = stepMessage(7, s, 'mordred', 1);
  assert.equal(cleanSettings({ ...s, ...msg.settings }).mordred, true);
});

test('non-hosts see every control disabled; the server still validates', () => {
  const m = setupSteppers(7, { merlin: true }, false);
  for (const r of m.rows) { assert.equal(r.plus.disabled, true); assert.equal(r.minus.disabled, true); }
  const room = newRoom('ABCDEF', 'hk'); const ids = [];
  for (let i = 0; i < 5; i++) ids.push(reduce(room, { anon: true }, { type: 'join', name: `P${i}`, hostKey: i === 0 ? 'hk' : undefined }).data.playerId);
  assert.match(reduce(room, { playerId: ids[1] }, { type: 'settings', settings: { percival: true } }).error, /host/i);
  reduce(room, { playerId: ids[0] }, { type: 'settings', settings: { merlin: false, percival: true } });
  assert.match(reduce(room, { playerId: ids[0] }, { type: 'start' }).error, /Percival needs Merlin/);
  void EVIL_COUNT; void ROLES;
});

test('with fewer than five players the steppers plan for a five-player table', () => {
  assert.equal(setupSteppers(2, { merlin: true }).n, MIN_PLAYERS);
  assert.equal(setupSteppers(12, { merlin: true }).n, MAX_PLAYERS);
});
