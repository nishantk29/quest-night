// Presets (item 3) and the setup carousel logic (item 8): every preset is valid at every size in its range, with the engine's own checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, savedPreset, presetSettings, presetForSettings, misfit, fits, allPresets } from '../public/js/presets.js';
import { roleList, ROLES, EVIL_COUNT, MIN_PLAYERS, MAX_PLAYERS, DEFAULT_SETTINGS } from '../public/js/rules.js';
import { setupState, defaultSeating, modeFor, SEATING, loadSetup, saveSetup, firstBlocked, clampStep } from '../public/js/setup.js';
import { DEFAULT_PRESET_ID, SETUP_STEPS } from '../public/js/config-defaults.js';
import { cleanMode, MODE_PRESETS, modeProblem } from '../public/js/table.js';
import { lintCopy } from './kit/copy-lint.mjs';

const sorted = (a) => [...a].sort();
const EXPECT = { 'round-table': [5, 10], 'plain-steel': [5, 10], 'seer-shield': [5, 10], outcast: [7, 10], 'mordreds-veil': [7, 10], 'full-court': [10, 10] };

test('the six Quest presets, in the drawn order, names exactly as drawn', () => {
  assert.deepEqual(PRESETS.map((p) => p.name), ['The Round Table', 'Plain Steel', 'Seer and Shield', 'The Outcast', 'Mordred’s Veil', 'Full Court']);
  assert.equal(PRESETS[0].id, DEFAULT_PRESET_ID);
  for (const p of PRESETS) assert.deepEqual([p.min, p.max], EXPECT[p.id]);
  assert.deepEqual(PRESETS.map((p) => p.difficulty), ['Beginner', 'Beginner', 'Classic', 'Classic', 'Veteran', 'Veteran']);
});

test('every preset is valid at every player count in its range, and null outside it', () => {
  for (const p of PRESETS) {
    for (let n = 1; n <= 14; n++) {
      const mix = p.mix(n);
      if (n < p.min || n > p.max) { assert.equal(mix, null, `${p.id} at ${n}`); continue; }
      assert.equal(mix.length, n, `${p.id} at ${n}`);
      const engine = roleList(n, presetSettings(p));
      assert.ok(!engine.error, `${p.id} at ${n}: ${engine.error}`);
      assert.deepEqual(sorted(mix), sorted(engine.roles), `${p.id} at ${n} matches the engine's deal`);
      const evil = mix.filter((r) => ROLES[r].side === 'evil').length;
      assert.equal(evil, EVIL_COUNT[n]);
      if (mix.includes('percival')) assert.ok(mix.includes('merlin'), 'Percival only with Merlin');
      assert.equal(mix.includes('merlin'), mix.includes('assassin'), 'Merlin with the Assassin');
      for (const r of mix) assert.ok(ROLES[r]);
    }
  }
});

test('named roles come first and Loyal Servants and Minions fill the rest', () => {
  assert.deepEqual(PRESETS.find((p) => p.id === 'full-court').mix(10), ['merlin', 'percival', 'servant', 'servant', 'servant', 'servant', 'assassin', 'morgana', 'mordred', 'oberon']);
  assert.ok(!PRESETS.find((p) => p.id === 'plain-steel').mix(8).some((r) => ['merlin', 'assassin', 'percival'].includes(r)));
});

test('saved presets: valid where the engine accepts them, dimmed (null) where it does not', () => {
  const sp = savedPreset({ id: 's1', name: 'Our table', settings: { merlin: true, morgana: true, mordred: true, oberon: true } });
  assert.ok(sp.saved);
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) assert.equal(!!sp.mix(n), !roleList(n, sp.settings).error, `n=${n}`);
  assert.match(misfit(sp, 5), /Needs \d+\+ players\. You have 5\./);
  assert.equal(allPresets([{ id: 's1', name: 'x', settings: DEFAULT_SETTINGS }]).length, 7);
});

test('misfit copy: "Needs 7+ players. You have 6."', () => {
  const outcast = PRESETS.find((p) => p.id === 'outcast');
  assert.equal(misfit(outcast, 6), 'Needs 7+ players. You have 6.');
  assert.equal(misfit(outcast, 8), '');
  assert.match(misfit(PRESETS.find((p) => p.id === 'full-court'), 8), /Needs 10\+/);
});

test('preset copy passes the copy lint and has no em dashes', () => {
  for (const p of PRESETS) for (const s of [p.name, p.vibe]) { assert.deepEqual(lintCopy(s), []); assert.ok(!/—/.test(s)); }
});

const view = (n, settings = DEFAULT_SETTINGS, phoneless = 0) => ({
  players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, host: i === 0, watch: false, phoneless: i >= n - phoneless })),
  settings, mode: { ...MODE_PRESETS.phone },
});

test('carousel: Next is blocked with a reason and a fix when something is wrong, and never otherwise', () => {
  assert.equal(SETUP_STEPS.length, 4);
  const few = setupState(view(4), [], { presetId: DEFAULT_PRESET_ID });
  assert.match(few.problems[0].text, /Add 1 more player to start \(5 minimum\)/);
  assert.ok(few.problems[0].fix.label);
  assert.equal(firstBlocked(few, 3), 0);
  const ok = setupState(view(6), [], { presetId: DEFAULT_PRESET_ID });
  assert.deepEqual(ok.problems, { 0: null, 1: null, 2: null, 3: null });
  assert.equal(ok.preset.id, 'round-table');
  assert.equal(firstBlocked(ok, 3), -1);
  assert.equal(setupState(view(11), []).problems[0].text.includes('seats 10'), true);
});

test('carousel: a preset that stops fitting names the fix; the room settings are the truth', () => {
  const full = { merlin: true, percival: true, morgana: true, mordred: true, oberon: true };
  const st = setupState(view(8, full), [], { presetId: 'full-court' });
  assert.equal(st.preset.id, 'full-court');
  assert.match(st.problems[1].text, /Full Court: Needs 10\+ players\. You have 8\. Change preset or add players\./);
  assert.equal(st.problems[1].fix.go, 'presets');
  assert.equal(setupState(view(8, { merlin: false }), []).preset.id, 'plain-steel');
  assert.equal(setupState(view(8, { merlin: true, oberon: true, percival: true }), []).custom, true);
});

test('seating: preselected from who joined, and maps onto the existing mode model', () => {
  assert.equal(defaultSeating(view(6).players), 'own');
  assert.equal(defaultSeating(view(6, DEFAULT_SETTINGS, 5).players), 'one');
  assert.equal(defaultSeating(view(6, DEFAULT_SETTINGS, 2).players), 'mixed');
  for (const id of ['own', 'one', 'mixed']) {
    const m = cleanMode(SEATING[id].mode);
    assert.equal(m.play, SEATING[id].mode.play);
  }
  // Mixed with a phoneless seat never trips modeProblem; Own phones with a phoneless seat is lifted to Mixed
  const room = { mode: cleanMode(SEATING.mixed.mode), players: view(6, DEFAULT_SETTINGS, 2).players };
  assert.equal(modeProblem(room), null);
  assert.deepEqual(modeFor('own', MODE_PRESETS.phone, room.players), SEATING.mixed.mode);
  assert.equal(modeFor('own', MODE_PRESETS.phone, view(6).players), null);
  assert.deepEqual(modeFor('one', MODE_PRESETS.phone, view(6).players), { play: 'physical' });
});

test('progress is remembered per room and survives a refresh; another room starts fresh', () => {
  const mem = new Map(); const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  saveSetup(store, { code: 'ABCD', step: 2, presetId: 'plain-steel', seating: 'one', seatingChosen: true, advancedOpen: false });
  assert.deepEqual(loadSetup(store, 'ABCD'), { code: 'ABCD', step: 2, presetId: 'plain-steel', seating: 'one', seatingChosen: true, advancedOpen: false });
  assert.equal(loadSetup(store, 'WXYZ').step, 0);
  mem.set('quest.setup.v1', '{bad'); assert.equal(loadSetup(store, 'ABCD').step, 0);
  mem.set('quest.setup.v1', JSON.stringify({ code: 'ABCD', step: 99 })); assert.equal(loadSetup(store, 'ABCD').step, 3);
  assert.equal(clampStep(-3), 0);
});

test('an old room (no saved setup) maps on load: default preset equals the engine default settings', () => {
  assert.deepEqual(presetSettings(PRESETS[0]), { merlin: true, percival: false, morgana: false, mordred: false, oberon: false });
  assert.equal(presetForSettings(DEFAULT_SETTINGS, 8).id, 'round-table');
});
