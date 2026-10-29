// The four-step setup carousel, as pure logic (item 8). No DOM. The UI renders what this says; tests drive it.
//   steps:   Players, Preset, Seating, Deal
//   Next is disabled with one plain reason and a fix; nothing ever blocks (every reason names a way out).
import { MIN_PLAYERS, MAX_PLAYERS, roleList } from './rules.js';
import { DEFAULT_PRESET_ID, SETUP_STEPS, SETUP_KEY } from './config-defaults.js';
import { findPreset, presetForSettings, presetSettings, sameSettings, misfit, fits } from './presets.js';

// Seating: where each person plays. Maps onto the room's existing mode (item 7). Mixed uses real cards for the secret parts
// because a seat with no phone already requires roles, votes and cards to be physical (modeProblem in table.js).
export const SEATING = {
  own: { id: 'own', label: 'Own phones', blurb: 'Everyone has joined on their own phone.', mode: { play: 'phone' } },
  one: { id: 'one', label: 'One phone', blurb: 'Pass this phone around. Real cards, or the app deals.', mode: { play: 'physical' } },
  mixed: { id: 'mixed', label: 'Mixed', blurb: 'Some on their own phones, the rest on this one.', mode: { play: 'hybrid', roles: 'physical', votes: 'physical', cards: 'physical' } },
};
export const SEATING_IDS = ['own', 'one', 'mixed'];

// Preselected from who joined: all on phones = own, nobody but the host on a phone = one, both = mixed.
export function defaultSeating(players) {
  const seats = players.filter((p) => !p.watch);
  const noPhone = seats.filter((p) => p.phoneless).length;
  const onPhone = seats.length - noPhone;
  if (!noPhone) return 'own';
  if (onPhone <= 1) return 'one';
  return 'mixed';
}
// The mode message to send for a seating choice, or null when the room is already there (hybrid pieces the host tuned are kept).
export function modeFor(seating, currentMode, players) {
  const want = SEATING[seating]?.mode; if (!want) return null;
  const phoneless = players.some((p) => !p.watch && p.phoneless);
  if (seating === 'own' && phoneless) return { ...SEATING.mixed.mode }; // a seat with no phone can't be on an all-phone table
  if (currentMode.play === want.play && want.play !== 'hybrid') return null;
  if (want.play === 'hybrid' && currentMode.play === 'hybrid' && (!phoneless || ['roles', 'votes', 'cards'].every((k) => currentMode[k] === 'physical'))) return null;
  return { ...want };
}
export const seatingLabel = (id, players) => {
  const off = players.filter((p) => !p.watch && p.phoneless).length;
  return id === 'mixed' ? `Mixed, ${off} on this phone` : SEATING[id]?.label || 'Own phones';
};

export const clampStep = (s) => (Number.isInteger(s) ? Math.max(0, Math.min(SETUP_STEPS.length - 1, s)) : 0);

// What the room tells the carousel. Returns the preset in use (built from the room's real settings), and per-step validity.
// v: the room view ({ players, settings, mode }). saved: the host's saved presets. local: { presetId }.
export function setupState(v, saved = [], local = {}) {
  const seated = v.players.filter((p) => !p.watch);
  const n = seated.length;
  const stored = local.presetId ? findPreset(local.presetId, saved) : null;
  // The room's settings are the truth. The remembered preset names them if its switches match, else a matching built-in, else Custom.
  const room = v.settings;
  const mine = stored && sameSettings(presetSettings(stored), room) ? stored : null;
  const preset = mine || presetForSettings(room, n, saved);
  const list = roleList(Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, n)), room);
  const problems = {
    0: n < MIN_PLAYERS ? { text: `Add ${MIN_PLAYERS - n} more ${MIN_PLAYERS - n === 1 ? 'player' : 'players'} to start (${MIN_PLAYERS} minimum).`, fix: { label: 'Add a name', go: 0, focus: 'name' } }
      : n > MAX_PLAYERS ? { text: `Quest Night seats ${MAX_PLAYERS}. Remove ${n - MAX_PLAYERS}.`, fix: { label: 'Remove a player', go: 0 } } : null,
    1: n < MIN_PLAYERS ? { text: `Add players first. Quest Night needs ${MIN_PLAYERS}.`, fix: { label: 'Back to Players', go: 0 } }
      : preset && !fits(preset, n) ? { text: `${preset.name}: ${misfit(preset, n).replace(/\.$/, '')}. Change preset or add players.`, fix: { label: 'Change preset', go: 'presets' } }
        : list.error ? { text: list.error, fix: { label: 'Change preset', go: 'presets' } } : null,
    2: null,
    3: null,
  };
  // Deal is blocked only by something an earlier step can fix.
  problems[3] = problems[0] || problems[1];
  return { n, preset, list, problems, custom: !preset };
}

// Next is disabled when the current step has a problem. Swiping forward past a problem snaps back to the first one.
export const firstBlocked = (state, upTo) => { for (let i = 0; i < upTo; i++) if (state.problems[i]) return i; return -1; };
export function nextLabel(step) { return ['Next: Pick roles', 'Next: Seating', 'Next: Review', 'Deal roles'][clampStep(step)]; }

// localStorage shape, kept per room code so an old room's step never opens a new room.
export function loadSetup(store, code) {
  let o = null; try { o = JSON.parse(store.getItem(SETUP_KEY)); } catch { /* none */ }
  if (!o || o.code !== code) return { code, step: 0, presetId: DEFAULT_PRESET_ID, seating: null, seatingChosen: false, advancedOpen: false };
  return { code, step: clampStep(o.step), presetId: typeof o.presetId === 'string' ? o.presetId : DEFAULT_PRESET_ID, seating: SEATING_IDS.includes(o.seating) ? o.seating : null, seatingChosen: !!o.seatingChosen, advancedOpen: !!o.advancedOpen };
}
export function saveSetup(store, s) { try { store.setItem(SETUP_KEY, JSON.stringify(s)); } catch { /* storage full or blocked */ } }
