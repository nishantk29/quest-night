// The setup steppers (lobby and "Change setup first"). Quest characters are unique, so each special is 0 or 1;
// Loyal Servants and Minions fill the rest. Pure: the UI renders it, the tests check it.
import { ROLES, EVIL_COUNT, roleList, cleanSettings, MIN_PLAYERS, MAX_PLAYERS } from './rules.js';

// key = the settings boolean (the message format old clients and rooms use); roles = what it deals.
export const STEPPERS = [
  { key: 'merlin', label: 'Merlin and the Assassin', icon: 'merlin', roles: ['merlin', 'assassin'], side: 'good', blurb: 'Merlin sees Evil. The Assassin gets one last strike.' },
  { key: 'percival', label: 'Percival', icon: 'percival', roles: ['percival'], side: 'good', blurb: 'Knows who might be Merlin.' },
  { key: 'morgana', label: 'Morgana', icon: 'morgana', roles: ['morgana'], side: 'evil', blurb: 'Looks like Merlin to Percival.' },
  { key: 'mordred', label: 'Mordred', icon: 'mordred', roles: ['mordred'], side: 'evil', blurb: 'An evil player Merlin cannot see.' },
  { key: 'oberon', label: 'Oberon', icon: 'oberon', roles: ['oberon'], side: 'evil', blurb: 'Evil, but alone: knows nobody, known by nobody.' },
];

export const planSeats = (players) => Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Number.isInteger(players) ? players : MIN_PLAYERS));

// players: seated count. Returns { n, error, ok, rows, fills }.
export function setupSteppers(players, settings, canEdit = true) {
  const n = planSeats(players);
  const s = cleanSettings(settings);
  const list = roleList(n, s);
  const evilN = EVIL_COUNT[n];
  const rows = STEPPERS.map((st) => {
    const value = s[st.key] ? 1 : 0;
    const trial = roleList(n, { ...s, [st.key]: true });
    let plus = null;
    if (!canEdit) plus = 'Only the host changes the roles.';
    else if (value >= 1) plus = 'Only one of each character.';
    else if (trial.error) plus = trial.error;
    const minus = !canEdit ? 'Only the host changes the roles.' : value <= 0 ? 'Already off.' : null;
    return { ...st, value, min: 0, max: 1, plus: { disabled: !!plus, reason: plus || '' }, minus: { disabled: !!minus, reason: minus || '' } };
  });
  const loyal = n - EVIL_COUNT[n];
  const specialsGood = (s.merlin ? 1 : 0) + (s.percival ? 1 : 0);
  const specialsEvil = (s.merlin ? 1 : 0) + (s.morgana ? 1 : 0) + (s.mordred ? 1 : 0) + (s.oberon ? 1 : 0);
  const fills = [
    { id: 'servant', label: ROLES.servant.name, icon: 'servant', side: 'good', count: Math.max(0, loyal - specialsGood), reason: 'Fills the rest of the Loyal seats.' },
    { id: 'minion', label: ROLES.minion.name, icon: 'minion', side: 'evil', count: Math.max(0, evilN - specialsEvil), reason: 'Fills the rest of the Evil seats.' },
  ];
  return { n, error: list.error || '', ok: !list.error, rows, fills };
}

// The settings message a tap sends, or null when that tap is disabled.
export function stepMessage(players, settings, key, dir, canEdit = true) {
  const row = setupSteppers(players, settings, canEdit).rows.find((r) => r.key === key);
  if (!row) return null;
  const b = dir > 0 ? row.plus : row.minus;
  return b.disabled ? null : { type: 'settings', settings: { [key]: dir > 0 } };
}
