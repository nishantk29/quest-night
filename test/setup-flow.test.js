// Setup carousel, presets and roles panel against the real room reducer: presets deal what they say, no step can block,
// the "Roles in this game" panel is identical for every viewer, and old saved setups map on load.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newRoom, reduce, viewForPlayer, viewForScreen } from '../public/js/room.js';
import { rolesInGame, rolesSeats, rolesPanelHtml, rolesButtonLabel, rolesSheetBody } from '../public/js/roles_sheet.js';
import { PRESETS, presetSettings, allPresets, savedPreset, presetForSettings } from '../public/js/presets.js';
import { setupState, defaultSeating, modeFor, firstBlocked, SEATING } from '../public/js/setup.js';
import { OPTIONAL, MIN_PLAYERS, MAX_PLAYERS, DEFAULT_SETTINGS, ROLES } from '../public/js/rules.js';
import { DEFAULT_PRESET_ID } from '../public/js/config-defaults.js';
import { MODE_PRESETS } from '../public/js/table.js';

const NOW = 1_800_000_000_000;
const rng = () => 0.37;
const esc = (s) => String(s);
const glyph = (n) => `<i>${n}</i>`;

function lobby(n, phoneless = 0) {
  const room = newRoom('SETUPA', 'hk');
  const ids = [];
  for (let i = 0; i < n - phoneless; i++) ids.push(reduce(room, {}, { type: 'join', name: `P${i}`, hostKey: i === 0 ? 'hk' : undefined }, rng, NOW).data.playerId);
  const H = { playerId: ids[0] };
  for (let i = 0; i < phoneless; i++) assert.ok(reduce(room, H, { type: 'addSeat', name: `S${i}` }, rng, NOW).ok);
  return { room, H, ids };
}

test('every preset, dealt by the real room at every size in range, deals exactly its mix', () => {
  for (const p of PRESETS) {
    for (let n = p.min; n <= p.max; n++) {
      const { room, H } = lobby(n);
      assert.ok(reduce(room, H, { type: 'settings', settings: presetSettings(p) }, rng, NOW).ok);
      const r = reduce(room, H, { type: 'start' }, rng, NOW);
      assert.ok(r.ok, `${p.id} at ${n}: ${r.error}`);
      assert.deepEqual(Object.values(room.game.roles).sort(), [...p.mix(n)].sort(), `${p.id} at ${n}`);
    }
  }
});

test('Seating choices deal through the real room: own phones, one phone, mixed', () => {
  for (const [seating, phoneless] of [['own', 0], ['one', 5], ['mixed', 2]]) {
    const { room, H } = lobby(6, phoneless);
    const players = viewForPlayer(room, H.playerId).players;
    assert.equal(defaultSeating(players), seating);
    const mm = modeFor(seating, room.mode, players);
    if (mm) assert.ok(reduce(room, H, { type: 'mode', mode: mm }, rng, NOW).ok);
    assert.equal(room.mode.play, SEATING[seating].mode.play);
    const r = reduce(room, H, { type: 'start' }, rng, NOW);
    assert.ok(r.ok, `${seating}: ${r.error}`);
  }
});

test('no step can block: every problem names a fix, and a valid default always exists', () => {
  const settingsSets = [DEFAULT_SETTINGS, ...PRESETS.map(presetSettings), { merlin: false, percival: true }, Object.fromEntries(OPTIONAL.map((k) => [k, true]))];
  for (let n = 1; n <= 11; n++) {
    for (const s of settingsSets) {
      const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, host: i === 0, watch: false, phoneless: false }));
      const v = { players, settings: { ...DEFAULT_SETTINGS, ...s }, mode: MODE_PRESETS.phone };
      const st = setupState(v, [], { presetId: DEFAULT_PRESET_ID });
      for (const i of [0, 1, 2, 3]) {
        const p = st.problems[i];
        if (!p) continue;
        assert.ok(p.text.length > 8, `step ${i} reason at n=${n}`);
        assert.ok(p.fix && p.fix.label && (p.fix.go === 'presets' || Number.isInteger(p.fix.go)), `step ${i} fix at n=${n}`);
      }
      assert.equal(st.problems[2], null, 'Seating is never blocked');
      // default settings at 5 to 10 players: nothing blocks, all the way to Deal
      if (s === DEFAULT_SETTINGS && n >= MIN_PLAYERS && n <= MAX_PLAYERS) assert.equal(firstBlocked(st, 4), -1);
      // every blocked state has an exit: the first blocked step is an earlier step or the presets page
      const b = firstBlocked(st, 4);
      if (b >= 0) assert.ok(st.problems[b].fix);
    }
    // the default preset fixes any preset problem at 5 to 10
    if (n >= MIN_PLAYERS && n <= MAX_PLAYERS) {
      const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, host: i === 0, watch: false, phoneless: false }));
      const st = setupState({ players, settings: presetSettings(PRESETS[0]), mode: MODE_PRESETS.phone }, [], { presetId: DEFAULT_PRESET_ID });
      assert.equal(firstBlocked(st, 4), -1);
    }
  }
});

test('removing a player so a preset no longer fits blocks only Next, with Change preset as the way out', () => {
  const { room } = lobby(10);
  const full = presetSettings(PRESETS.find((p) => p.id === 'full-court'));
  let v = { players: viewForPlayer(room, 'p0').players, settings: full, mode: MODE_PRESETS.phone };
  assert.equal(setupState(v, [], { presetId: 'full-court' }).problems[1], null);
  v = { ...v, players: v.players.slice(0, 7) };
  const st = setupState(v, [], { presetId: 'full-court' });
  assert.match(st.problems[1].text, /Full Court/);
  assert.equal(st.problems[1].fix.go, 'presets');
  assert.equal(st.problems[0], null);
});

test('the roles panel is identical for every viewer of the same table, whatever role they hold', () => {
  for (const [n, preset] of [[5, 'round-table'], [7, 'mordreds-veil'], [8, 'seer-shield'], [10, 'full-court'], [6, 'plain-steel']]) {
    const { room, H, ids } = lobby(n);
    reduce(room, H, { type: 'settings', settings: presetSettings(PRESETS.find((p) => p.id === preset)) }, rng, NOW);
    assert.ok(reduce(room, H, { type: 'start' }, () => 0.61, NOW).ok);
    const views = ids.map((id) => viewForPlayer(room, id));
    const panels = views.map((v) => rolesPanelHtml(rolesInGame(rolesSeats(v), v.settings), esc, glyph, rolesButtonLabel(v)));
    assert.equal(new Set(panels).size, 1, `${preset}: one render for ${n} viewers`);
    // roles differ between viewers, the render does not
    assert.ok(new Set(views.map((v) => v.me.role?.id || v.me.role)).size > 1);
    // and carries no names, ids or per-player secrets
    for (const v of views) for (const p of v.players) assert.ok(!panels[0].includes(`>${p.name}<`) && !panels[0].includes(p.id));
    // the spectator screen view gets the same body
    const sv = viewForScreen(room);
    assert.equal(rolesSheetBody(rolesInGame(rolesSeats(sv), sv.settings), esc, glyph), rolesSheetBody(rolesInGame(rolesSeats(views[0]), views[0].settings), esc, glyph));
    // counts: the panel lists exactly the dealt roles
    const info = rolesInGame(rolesSeats(views[0]), views[0].settings);
    const dealt = {}; for (const r of Object.values(room.game.roles)) dealt[r] = (dealt[r] || 0) + 1;
    for (const g of info.groups) for (const r of g.roles) assert.equal(r.count, dealt[r.id]);
    assert.equal(Object.values(dealt).reduce((a, b) => a + b, 0), n);
  }
});

test('panel button label depends on the seat, never on the role held', () => {
  const { room, H, ids } = lobby(5);
  reduce(room, H, { type: 'start' }, rng, NOW);
  const labels = ids.map((id) => rolesButtonLabel(viewForPlayer(room, id)));
  assert.deepEqual([...new Set(labels)], ['See my role']);
});

test('old rooms and saved setups map on load: no preset stored, the room settings name the preset', () => {
  for (const p of PRESETS) assert.equal(presetForSettings(presetSettings(p), p.max).id, p.id);
  assert.equal(presetForSettings({ merlin: true, percival: true, oberon: true }, 8), null);
  const saved = [{ id: 's1', name: 'Ours', settings: { merlin: true, percival: true, oberon: true } }];
  assert.equal(presetForSettings({ merlin: true, percival: true, oberon: true }, 8, saved).id, 's1');
  assert.equal(allPresets(saved).length, 7);
  assert.ok(savedPreset(saved[0]).mix(8));
  // a stored id that no longer exists (deleted saved preset) falls back to what the room is actually set to
  const st = setupState({ players: lobby(8).room.players.map((p) => ({ ...p, watch: false })), settings: DEFAULT_SETTINGS, mode: MODE_PRESETS.phone }, [], { presetId: 's-gone' });
  assert.equal(st.preset.id, 'round-table');
  for (const r of Object.values(ROLES)) assert.ok(r.blurb);
});
