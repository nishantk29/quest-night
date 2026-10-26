// Quest Night: the rules, written once and shared by the Worker, the browser and the tests.
// Pure functions only. No DOM, no storage, no network.

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 10;

// How many players are on the evil side, by table size.
export const EVIL_COUNT = { 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4 };

// Quest team sizes, quests 1 to 5, by table size.
export const QUEST_SIZES = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
};

export const QUESTS_TO_WIN = 3;
export const MAX_REJECTS = 5; // the fifth turned-down proposal in a row hands the game to Evil

// Sabotage cards needed to break a quest. Quest 4 needs two at tables of 7 or more.
export const failsNeeded = (players, questIndex) => (players >= 7 && questIndex === 3 ? 2 : 1);

export const SIDES = {
  good: { name: 'the Loyal Servants of Arthur', short: 'Loyal' },
  evil: { name: 'the Minions of Mordred', short: 'Evil' },
};

// Original names and lines. Mechanics follow the classic hidden-minion quest game.
export const ROLES = {
  servant: { id: 'servant', name: 'Loyal Servant of Arthur', side: 'good', icon: 'servant',
    blurb: 'You know nothing but your own heart. Find the minions by how they vote.' },
  merlin: { id: 'merlin', name: 'Merlin', side: 'good', icon: 'merlin',
    blurb: 'You see Evil. Guide the realm, but softly: if they find you at the end, all is lost.' },
  percival: { id: 'percival', name: 'Percival', side: 'good', icon: 'percival',
    blurb: 'You know who might be Merlin. Shield them, and do not be fooled by Morgana.' },
  minion: { id: 'minion', name: 'Minion of Mordred', side: 'evil', icon: 'minion',
    blurb: 'You know your fellow minions. Smile, volunteer, and sabotage when it counts.' },
  assassin: { id: 'assassin', name: 'The Assassin', side: 'evil', icon: 'assassin',
    blurb: 'If three quests succeed, you get one strike. Name Merlin and Evil still wins.' },
  morgana: { id: 'morgana', name: 'Morgana', side: 'evil', icon: 'morgana',
    blurb: 'To Percival you look exactly like Merlin. Play the part.' },
  mordred: { id: 'mordred', name: 'Mordred', side: 'evil', icon: 'mordred',
    blurb: 'Even Merlin cannot see you. Hide in plain sight.' },
  oberon: { id: 'oberon', name: 'Oberon', side: 'evil', icon: 'oberon',
    blurb: 'You serve Evil, but alone: you do not know the other minions and they do not know you.' },
};

// Host settings. Merlin and the Assassin come as a pair: the Assassin's last strike is what keeps
// Merlin from simply naming everyone.
export const DEFAULT_SETTINGS = { merlin: true, percival: false, morgana: false, mordred: false, oberon: false };
export const OPTIONAL = ['merlin', 'percival', 'morgana', 'mordred', 'oberon'];

export function cleanSettings(s = {}) {
  const out = {};
  for (const k of OPTIONAL) out[k] = typeof s[k] === 'boolean' ? s[k] : DEFAULT_SETTINGS[k];
  return out;
}

// The list of role ids to deal, or { error }.
export function roleList(players, settings) {
  const n = players;
  if (!Number.isInteger(n) || n < MIN_PLAYERS) return { error: `You need at least ${MIN_PLAYERS} players.` };
  if (n > MAX_PLAYERS) return { error: `At most ${MAX_PLAYERS} players can play.` };
  const s = cleanSettings(settings);
  if (s.percival && !s.merlin) return { error: 'Percival needs Merlin. Turn Merlin on, or turn Percival off.' };
  const evilN = EVIL_COUNT[n];
  const loyalN = n - evilN;
  const evil = [];
  if (s.merlin) evil.push('assassin');
  if (s.morgana) evil.push('morgana');
  if (s.mordred) evil.push('mordred');
  if (s.oberon) evil.push('oberon');
  if (evil.length > evilN) return { error: `${n} players have only ${evilN} Evil seats. Turn off ${evil.length - evilN} Evil role${evil.length - evilN > 1 ? 's' : ''}.` };
  while (evil.length < evilN) evil.push('minion');
  const good = [];
  if (s.merlin) good.push('merlin');
  if (s.percival) good.push('percival');
  while (good.length < loyalN) good.push('servant');
  return { roles: [...good, ...evil] };
}

export function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// What one player learns at the start. `roles` maps playerId -> roleId.
// Returns [{ id, tag }] where tag is 'evil' (known minion) or 'merlin?' (Merlin or Morgana).
// `order` is the game's own random order of player ids: lists follow it, never seat or role order, so a list
// says nothing about who is who (Percival's two candidates in particular). Games dealt before it existed use seat order.
export function knowledgeFor(playerId, roles, order = null) {
  const mine = roles[playerId];
  const ids = order ? order.filter((id) => id in roles) : Object.keys(roles);
  const others = ids.filter((id) => id !== playerId);
  if (mine === 'merlin') return others.filter((id) => ROLES[roles[id]].side === 'evil' && roles[id] !== 'mordred').map((id) => ({ id, tag: 'evil' }));
  if (mine === 'percival') return others.filter((id) => roles[id] === 'merlin' || roles[id] === 'morgana').map((id) => ({ id, tag: 'merlin?' }));
  if (ROLES[mine].side === 'evil' && mine !== 'oberon') return others.filter((id) => ROLES[roles[id]].side === 'evil' && roles[id] !== 'oberon').map((id) => ({ id, tag: 'evil' }));
  return [];
}

// A proposal passes on a strict majority of everyone at the table.
export const proposalPasses = (approvals, players) => approvals * 2 > players;

// Who has won, from the quest results so far. 'good' means three quests succeeded (the Assassin may
// still strike); 'evil' means three failed.
export function questWinner(results) {
  const ok = results.filter((r) => r === 'success').length;
  const bad = results.filter((r) => r === 'fail').length;
  if (ok >= QUESTS_TO_WIN) return 'good';
  if (bad >= QUESTS_TO_WIN) return 'evil';
  return null;
}

// The Lantern (optional, the classic loyalty-check token). It starts with the player to the right of the
// first leader and is used after quests 2, 3 and 4. The holder learns one player's side; the Lantern then
// passes to that player, and nobody who has held it can be looked at.
export const LANTERN_AFTER = [2, 3, 4]; // number of finished quests at which the check happens
export const sideOf = (roleId) => ROLES[roleId].side;

// Game-specific house rules (all off by default). Common ones live in table.js.
export const HOUSE_DEFAULTS = { lantern: false };
