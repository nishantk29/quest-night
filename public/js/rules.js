// Quest Night: the rules, written once and shared by the Worker, the browser and the tests.
// Pure functions only. No DOM, no storage, no network.

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 10;

// How many players are on the Shadow (evil) side, by table size.
export const SHADOW_COUNT = { 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4 };

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
export const MAX_REJECTS = 5; // the fifth turned-down proposal in a row hands the game to the Shadow

// Sabotage cards needed to break a quest. Quest 4 needs two at tables of 7 or more.
export const failsNeeded = (players, questIndex) => (players >= 7 && questIndex === 3 ? 2 : 1);

export const SIDES = {
  loyal: { name: 'the Loyal', short: 'Loyal' },
  shadow: { name: 'the Shadow', short: 'Shadow' },
};

// Original names and lines. Mechanics follow the classic hidden-traitor quest game.
export const ROLES = {
  knight: { id: 'knight', name: 'Loyal Knight', side: 'loyal', icon: 'knight',
    blurb: 'You know nothing but your own heart. Find the traitors by how they vote.' },
  seer: { id: 'seer', name: 'The Seer', side: 'loyal', icon: 'seer',
    blurb: 'You see the Shadow. Guide the realm, but softly: if they find you at the end, all is lost.' },
  herald: { id: 'herald', name: 'The Herald', side: 'loyal', icon: 'herald',
    blurb: 'You know who might be the Seer. Shield them, and do not be fooled by the Enchantress.' },
  traitor: { id: 'traitor', name: 'Traitor', side: 'shadow', icon: 'traitor',
    blurb: 'You know your fellow traitors. Smile, volunteer, and sabotage when it counts.' },
  assassin: { id: 'assassin', name: 'The Assassin', side: 'shadow', icon: 'assassin',
    blurb: 'If three quests succeed, you get one strike. Name the Seer and the Shadow still wins.' },
  enchantress: { id: 'enchantress', name: 'The Enchantress', side: 'shadow', icon: 'enchantress',
    blurb: 'To the Herald you look exactly like the Seer. Play the part.' },
  usurper: { id: 'usurper', name: 'The Usurper', side: 'shadow', icon: 'usurper',
    blurb: 'Even the Seer cannot see you. Hide in plain sight.' },
  outcast: { id: 'outcast', name: 'The Outcast', side: 'shadow', icon: 'outcast',
    blurb: 'You serve the Shadow, but alone: you do not know the other traitors and they do not know you.' },
};

// Host settings. The Seer and the Assassin come as a pair: the Assassin's last strike is what keeps
// the Seer from simply naming everyone.
export const DEFAULT_SETTINGS = { seer: true, herald: false, enchantress: false, usurper: false, outcast: false };
export const OPTIONAL = ['seer', 'herald', 'enchantress', 'usurper', 'outcast'];

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
  const shadowN = SHADOW_COUNT[n];
  const loyalN = n - shadowN;
  const shadow = [];
  if (s.seer) shadow.push('assassin');
  if (s.enchantress) shadow.push('enchantress');
  if (s.usurper) shadow.push('usurper');
  if (s.outcast) shadow.push('outcast');
  if (shadow.length > shadowN) return { error: `${n} players have only ${shadowN} Shadow seats. Turn off ${shadow.length - shadowN} Shadow role${shadow.length - shadowN > 1 ? 's' : ''}.` };
  while (shadow.length < shadowN) shadow.push('traitor');
  const loyal = [];
  if (s.seer) loyal.push('seer');
  if (s.herald) loyal.push('herald');
  while (loyal.length < loyalN) loyal.push('knight');
  return { roles: [...loyal, ...shadow] };
}

export function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// What one player learns at the start. `roles` maps playerId -> roleId.
// Returns [{ id, tag }] where tag is 'shadow' (known traitor) or 'seer?' (Seer or Enchantress).
export function knowledgeFor(playerId, roles) {
  const mine = roles[playerId];
  const others = Object.keys(roles).filter((id) => id !== playerId);
  if (mine === 'seer') return others.filter((id) => ROLES[roles[id]].side === 'shadow' && roles[id] !== 'usurper').map((id) => ({ id, tag: 'shadow' }));
  if (mine === 'herald') return others.filter((id) => roles[id] === 'seer' || roles[id] === 'enchantress').map((id) => ({ id, tag: 'seer?' }));
  if (ROLES[mine].side === 'shadow' && mine !== 'outcast') return others.filter((id) => ROLES[roles[id]].side === 'shadow' && roles[id] !== 'outcast').map((id) => ({ id, tag: 'shadow' }));
  return [];
}

// A proposal passes on a strict majority of everyone at the table.
export const proposalPasses = (approvals, players) => approvals * 2 > players;

// Who has won, from the quest results so far. 'loyal' means three quests succeeded (the Assassin may
// still strike); 'shadow' means three failed.
export function questWinner(results) {
  const ok = results.filter((r) => r === 'success').length;
  const bad = results.filter((r) => r === 'fail').length;
  if (ok >= QUESTS_TO_WIN) return 'loyal';
  if (bad >= QUESTS_TO_WIN) return 'shadow';
  return null;
}
