// Quest Night presets (item 3). Plain data: { id, name, vibe, min, max, difficulty, mix(n) }.
// mix(n) returns the role ids to deal, or null when n is outside the preset's range. It is written from EVIL_COUNT and the
// role ids directly (not through roleList), so the unit test can check it against the engine. A preset only picks which
// optional characters are on; the engine's own rules still decide the deal, so no rule changes and no rulesVersion bump.
import { EVIL_COUNT, OPTIONAL, MIN_PLAYERS, MAX_PLAYERS, cleanSettings } from './rules.js';

const GOOD_SPECIAL = ['merlin', 'percival'];
const EVIL_SPECIAL = ['assassin', 'morgana', 'mordred', 'oberon'];

// Named roles fill seats first, then Loyal Servants and Minions of Mordred fill the rest.
function mixOf(good, evil) {
  return (n) => {
    const evilN = EVIL_COUNT[n];
    if (!evilN) return null;
    const g = [...good]; const e = [...evil];
    while (g.length < n - evilN) g.push('servant');
    while (e.length < evilN) e.push('minion');
    return g.length + e.length === n && e.length === evilN ? [...g, ...e] : null;
  };
}
const preset = (id, name, vibe, min, max, difficulty, good, evil) => {
  const make = mixOf(good, evil);
  return { id, name, vibe, min, max, difficulty, good, evil, mix: (n) => (n >= min && n <= max ? make(n) : null) };
};

export const PRESETS = [
  preset('round-table', 'The Round Table', 'The standard game. Merlin knows, the Assassin hunts.', 5, 10, 'Beginner', ['merlin'], ['assassin']),
  preset('plain-steel', 'Plain Steel', 'No powers. Just votes, quests and faces.', 5, 10, 'Beginner', [], []),
  preset('seer-shield', 'Seer and Shield', 'Percival guards Merlin. Morgana muddies it.', 5, 10, 'Classic', ['merlin', 'percival'], ['assassin', 'morgana']),
  preset('outcast', 'The Outcast', 'One Minion works alone, and nobody knows who.', 7, 10, 'Classic', ['merlin'], ['assassin', 'oberon']),
  preset('mordreds-veil', 'Mordred’s Veil', 'Even Merlin can’t see the leader.', 7, 10, 'Veteran', ['merlin', 'percival'], ['assassin', 'morgana', 'mordred']),
  preset('full-court', 'Full Court', 'Every role at once.', 10, 10, 'Veteran', ['merlin', 'percival'], ['assassin', 'morgana', 'mordred', 'oberon']),
];

// The room's settings flags for a role list (the message format rooms already use).
export function settingsOfRoles(good, evil) {
  const all = [...good, ...evil];
  return cleanSettings({ merlin: all.includes('merlin'), percival: all.includes('percival'), morgana: all.includes('morgana'), mordred: all.includes('mordred'), oberon: all.includes('oberon') });
}
export const presetSettings = (p) => p.settings || settingsOfRoles(p.good, p.evil);
export const sameSettings = (a, b) => OPTIONAL.every((k) => !!a[k] === !!b[k]);

// A saved preset keeps the role switches (and nothing else the room could change under it). Fits 5 to 10 whenever the engine accepts it.
export function savedPreset({ id, name, settings }) {
  const s = cleanSettings(settings);
  const good = ['merlin', 'percival'].filter((k) => s[k]);
  const evil = [s.merlin && 'assassin', s.morgana && 'morgana', s.mordred && 'mordred', s.oberon && 'oberon'].filter(Boolean);
  const p = preset(id, name, 'Saved on this phone.', MIN_PLAYERS, MAX_PLAYERS, 'Classic', good, evil);
  p.saved = true; p.settings = s;
  const base = p.mix;
  // a saved mix is valid only where the engine has enough Evil seats for its characters
  p.mix = (n) => { const m = base(n); return m && evil.length <= EVIL_COUNT[n] ? m : null; };
  p.min = Math.max(MIN_PLAYERS, evil.length ? [5, 6, 7, 8, 9, 10].find((n) => evil.length <= EVIL_COUNT[n]) || MIN_PLAYERS : MIN_PLAYERS);
  return p;
}

export const allPresets = (saved = []) => [...PRESETS, ...saved.map(savedPreset)];
export const findPreset = (id, saved = []) => allPresets(saved).find((p) => p.id === id) || null;
export const fits = (p, n) => !!p.mix(n);

// The preset whose switches equal the room's settings (a built-in first), or null for a custom setup.
export function presetForSettings(settings, n, saved = []) {
  const s = cleanSettings(settings);
  return allPresets(saved).find((p) => sameSettings(presetSettings(p), s) && p.mix(n)) || allPresets(saved).find((p) => sameSettings(presetSettings(p), s)) || null;
}

// Why a preset does not fit: one plain line, or '' when it fits.
export function misfit(p, n) {
  if (p.mix(n)) return '';
  if (n < p.min) return `Needs ${p.min}+ players. You have ${n}.`;
  if (n > p.max) return p.min === p.max ? `Made for ${p.max} players. You have ${n}.` : `Made for ${p.min} to ${p.max} players. You have ${n}.`;
  return 'Not enough Evil seats for these characters at this table size.';
}
export const rangeText = (p) => (p.min === p.max ? `${p.min} players` : `${p.min} to ${p.max} players`);
export const countsOf = (roles) => { const m = new Map(); for (const r of roles) m.set(r, (m.get(r) || 0) + 1); return m; };
export { GOOD_SPECIAL, EVIL_SPECIAL };

// One plain line per role for the preset cards and the setup list (the long blurbs stay in the roles sheet).
export const ROLE_LINE = {
  merlin: 'Sees Evil. Must stay hidden.', servant: 'Knows only their own heart.', percival: 'Knows who might be Merlin.',
  assassin: 'One strike at Merlin at the end.', minion: 'Knows the other minions.', morgana: 'Looks like Merlin to Percival.',
  mordred: 'Evil, and hidden even from Merlin.', oberon: 'Evil, and works alone.',
};
export const ROLE_ORDER = ['merlin', 'percival', 'servant', 'assassin', 'morgana', 'mordred', 'oberon', 'minion'];
export const DIFFICULTY_PIPS = { Beginner: 1, Classic: 2, Veteran: 3 };
