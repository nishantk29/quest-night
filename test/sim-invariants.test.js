// Whole Quest Night games under invariant oracles: seeded, in-process, no server. Every table size from 5 to 10, every
// legal set of optional roles, Lantern on and off, and the phone, hybrid and physical play modes. Each game plays random
// but legal moves, mixes in illegal ones (they must be refused and change nothing), and adds pauses, late joiners,
// reconnects, Restarts and Play again. The first test to run plays every game once and records what broke; the five
// tests below each read their own part of that record. The classic rules are written out again here, so a slip in
// rules.js shows up as a disagreement. scripts/sim-games.mjs is the online version.
// Coverage: each (table size, optional roles, Lantern) pair is played GAMES / 240 times, and play modes rotate across
// the cycles. SIM_GAMES=2400 covers the whole product of pairs and modes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRoom, reduce, viewForPlayer, viewForScreen, LATEST_RULES_VERSION } from '../public/js/room.js';
import { roleList, knowledgeFor, shuffle, OPTIONAL, MIN_PLAYERS, MAX_PLAYERS, EVIL_COUNT, QUEST_SIZES, MAX_REJECTS } from '../public/js/rules.js';

const GAMES = Number(process.env.SIM_GAMES) || 2000;
const SEED = 20261025;
const NOW = 1_800_000_000_000;
const HOST_KEY = 'sim-host';
const MAX_STEPS = 3000; // per room, a guard against a table that never finishes
const MAX_DEALS = 3;
const PHASES = ['lobby', 'reveal', 'propose', 'vote', 'quest', 'lantern', 'assassin', 'over'];
const REASONS = ['rejects', 'quests', 'assassin', 'survived'];
const GAME_KEYS = new Set(['n', 'sizes', 'needs', 'results', 'questFails', 'quest', 'rejects', 'maxRejects', 'leader', 'team',
  'voted', 'played', 'ready', 'history', 'lastVote', 'lastQuest', 'roleSet', 'appRoles', 'lantern', 'winner', 'reason', 'target',
  'evil', 'assassin', 'roles']); // every field a view may carry; anything else is a leak
// The classic sides, written out here rather than imported from rules.js.
const EVIL = new Set(['minion', 'assassin', 'morgana', 'mordred', 'oberon']);
const side = (role) => (EVIL.has(role) ? 'evil' : 'good');

function lcg(seed) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }

// Table sizes, optional roles and Lantern: every pair that roleList can deal.
const SETS = Array.from({ length: 32 }, (_, m) => Object.fromEntries(OPTIONAL.map((k, i) => [k, ((m >> i) & 1) === 1])));
const PAIRS = [];
for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) for (const settings of SETS) {
  if (roleList(n, settings).error) continue;
  for (const lantern of [false, true]) PAIRS.push({ n, settings, lantern });
}
const MODES = [{ play: 'phone' }, { play: 'physical' }];
for (const roles of ['app', 'physical']) for (const votes of ['app', 'physical']) for (const cards of ['app', 'physical']) MODES.push({ play: 'hybrid', roles, votes, cards });
const caseFor = (g) => ({ ...PAIRS[g % PAIRS.length], mode: MODES[(g + Math.floor(g / PAIRS.length)) % MODES.length] });

const pick = (rng, a) => a[Math.floor(rng() * a.length)];
const seatIds = (room) => room.players.filter((p) => !p.watch).map((p) => p.id);
const hostOf = (room) => ({ playerId: room.players.find((p) => p.host).id });
const sameIds = (a, b) => [...a].sort().join() === [...b].sort().join();
// Everything a refused action must leave alone (the log is compared by its counter, so new entries show up).
const snap = (room) => JSON.stringify({ players: room.players, game: room.game, phase: room.phase, logN: room.logN, paused: room.paused,
  timer: room.timer, mode: room.mode, house: room.house, settings: room.settings, rulesVersion: room.rulesVersion, undo: room.undo.length });
const roleViewsIn = (x, out = []) => {
  if (x && typeof x === 'object') { if ('sideName' in x) out.push(x); for (const v of Object.values(x)) roleViewsIn(v, out); }
  return out;
};

// What a player knows under the classic rules, in the game's random order. Tags: 'evil' or 'merlin?'.
function expectedSees(id, roles, order) {
  const r = roles[id];
  const others = order.filter((x) => x !== id);
  if (r === 'merlin') return others.filter((x) => EVIL.has(roles[x]) && roles[x] !== 'mordred').map((x) => ({ id: x, tag: 'evil' }));
  if (r === 'percival') return others.filter((x) => roles[x] === 'merlin' || roles[x] === 'morgana').map((x) => ({ id: x, tag: 'merlin?' }));
  if (EVIL.has(r) && r !== 'oberon') return others.filter((x) => EVIL.has(roles[x]) && roles[x] !== 'oberon').map((x) => ({ id: x, tag: 'evil' }));
  return [];
}

// One action. Legal ones must be accepted; illegal ones must be refused and leave the table exactly as it was.
function send(st, room, actor, msg, legal) {
  const before = legal ? null : snap(room);
  const res = reduce(room, actor, msg, st.rng, NOW + st.steps);
  st.stats.moves++;
  if (msg.type !== 'start') checkState(st, room); // after every reduce; a new deal is checked by dealChecks instead
  if (legal && !res.ok) st.rec.impossible.push(`${st.tag}: legal ${msg.type} refused: ${res.error}`);
  if (!legal) {
    st.stats.illegal++;
    if (res.ok) st.rec.impossible.push(`${st.tag}: illegal ${msg.type} accepted`);
    else if (snap(room) !== before) st.rec.impossible.push(`${st.tag}: refused ${msg.type} changed the table`);
  }
  return res.ok;
}

// Checks run after every deal, whether it came from Start, Restart or Play again.
function dealChecks(st, room) {
  const g = room.game;
  const seats = seatIds(room);
  const bad = (m) => st.rec.knowledge.push(`${st.tag}: ${m}`);
  const expected = roleList(seats.length, room.settings);
  st.n = seats.length;
  st.dealIds = seats.slice();
  st.intended = 0; st.nResults = 0; st.hit = null;
  if (expected.error) { st.rec.impossible.push(`${st.tag}: the settings no longer deal: ${expected.error}`); return; }
  st.roleKey = [...expected.roles].sort().join();
  st.roleSetKey = [...new Set(expected.roles)].sort().join();
  st.hasAssassin = expected.roles.includes('assassin');
  if (!g) return;
  if (g.n !== seats.length) st.rec.impossible.push(`${st.tag}: a ${g.n}-player deal at a table of ${seats.length}`);
  if (g.roleSet.join() !== st.roleSetKey) st.rec.impossible.push(`${st.tag}: roleSet does not match roleList`);
  if (!sameIds(g.order, seats)) bad('the random order is not a permutation of the seats');
  if (!g.roles) return; // physical roles: the engine never sees who is who, so there is nothing more to check
  if (!sameIds(Object.keys(g.roles), seats)) bad('roles dealt to the wrong players');
  if (Object.values(g.roles).sort().join() !== st.roleKey) st.rec.impossible.push(`${st.tag}: the deal does not match roleList`);
  if (Object.values(g.roles).filter((r) => EVIL.has(r)).length !== EVIL_COUNT[seats.length]) st.rec.impossible.push(`${st.tag}: Evil count wrong`);
  for (const id of seats) {
    const want = expectedSees(id, g.roles, g.order);
    const got = knowledgeFor(id, g.roles, g.order);
    if (JSON.stringify(got) !== JSON.stringify(want)) bad(`${g.roles[id]} knows ${JSON.stringify(got)}, classic rules say ${JSON.stringify(want)}`);
    const sees = viewForPlayer(room, id).me.sees;
    if (JSON.stringify(sees) !== JSON.stringify(want)) bad(`${g.roles[id]}'s view disagrees with the classic rules`);
  }
  const perc = seats.find((id) => g.roles[id] === 'percival');
  const two = perc && expectedSees(perc, g.roles, g.order);
  if (two && two.length === 2) st.rec.stats.percivalFirst[g.roles[two[0].id]]++; // both must come up: the order is random
}

function deal(st, room) {
  if (send(st, room, hostOf(room), { type: 'start' }, true)) dealChecks(st, room);
}

function restart(st, room) {
  const H = hostOf(room);
  const before = snap(room);
  const ids = room.players.map((p) => p.id);
  const { code, gameNo } = room;
  const res = reduce(room, H, { type: 'restart' }, st.rng, NOW + st.steps);
  if (!res.ok) {
    st.stats.refusedRestarts++;
    if (snap(room) !== before) st.rec.restart.push(`${st.tag}: a refused restart changed the table`);
    return false;
  }
  st.stats.restarts++;
  const g = room.game;
  const bad = (m) => st.rec.restart.push(`${st.tag} [${st.steps}]: ${m}`);
  if (room.code !== code) bad('the room code changed');
  if (!ids.every((id) => room.players.some((p) => p.id === id))) bad('a player was lost');
  if (room.rulesVersion !== LATEST_RULES_VERSION) bad(`rulesVersion ${room.rulesVersion} after Restart`);
  if (room.gameNo !== gameNo + 1) bad('gameNo did not move on');
  if (room.phase !== 'reveal') bad(`phase ${room.phase} after Restart`);
  if (g.results.length || g.questFails.length || g.quest || g.rejects || g.history.length || g.team.length) bad('old quest results survived');
  if (Object.keys(g.ready).length) bad('old ready marks survived');
  if (room.log.some((e) => e.kind !== 'game')) bad('old log or chat survived');
  if (room.timer || room.paused) bad('a timer or pause survived');
  dealChecks(st, room);
  checkState(st, room);
  return true;
}

// Play again: back to the lobby, late watchers seated and the extra seats kicked, new settings for the same table size.
function again(st, room) {
  const H = hostOf(room);
  send(st, room, H, { type: 'again' }, true);
  for (const p of room.players.filter((x) => x.name.startsWith('W') && !x.host)) send(st, room, H, { type: 'kick', id: p.id }, true);
  const c = pick(st.rng, PAIRS.filter((x) => x.n === seatIds(room).length)); // the table may have shrunk by the kicks
  send(st, room, H, { type: 'mode', mode: pick(st.rng, MODES) }, true);
  send(st, room, H, { type: 'house', house: { lantern: c.lantern } }, true);
  send(st, room, H, { type: 'settings', settings: c.settings }, true);
  deal(st, room);
}

function kickWatchers(st, room) {
  const H = hostOf(room);
  for (const p of room.players.filter((x) => x.watch && !x.host)) send(st, room, H, { type: 'kick', id: p.id }, true);
}

// Illegal moves, each one refused in the current state.
function tryIllegal(st, room) {
  const H = hostOf(room);
  const seats = seatIds(room);
  const other = { playerId: pick(st.rng, seats.filter((x) => x !== H.playerId)) };
  const menu = [[other, { type: 'restart' }], [other, { type: 'nonsense' }], [H, { type: 'start' }], [other, { type: 'again' }]];
  if (room.phase !== 'vote') menu.push([other, { type: 'vote', approve: true }]);
  if (room.phase !== 'quest') menu.push([other, { type: 'play', sabotage: true }]);
  if (room.phase !== 'propose') menu.push([other, { type: 'propose', team: seats.slice(0, 2) }]);
  if (room.phase !== 'lantern') menu.push([other, { type: 'examine', id: other.playerId }]);
  if (room.phase !== 'assassin') menu.push([other, { type: 'strike', id: other.playerId }]);
  if (room.phase !== 'reveal') menu.push([other, { type: 'ready' }]);
  const [actor, msg] = pick(st.rng, menu);
  send(st, room, actor, msg, false);
}

// One move from the current phase: mostly legal, now and then an illegal one that must be refused.
function step(st, room) {
  const { rng } = st;
  const g = room.game;
  if (!g) return;
  const H = hostOf(room);
  const seats = seatIds(room);
  const any = { playerId: pick(rng, seats) };
  if (room.paused) { send(st, room, any, { type: 'ready' }, false); send(st, room, H, { type: 'resume' }, true); return; }
  if (rng() < 0.02) { send(st, room, H, { type: 'pause' }, true); return; }
  if (rng() < 0.03) send(st, room, any, { type: 'chat', text: 'Hello table' }, true);
  if (rng() < 0.01) send(st, room, {}, { type: 'join', name: `W${st.late++}` }, true); // a late joiner watches
  if (rng() < 0.005) { restart(st, room); return; }
  if (rng() < 0.08) { tryIllegal(st, room); return; }
  switch (room.phase) {
    case 'reveal': {
      if (rng() < 0.05) return void send(st, room, H, { type: 'skipReveal' }, true);
      const waiting = seats.filter((id) => !g.ready[id]);
      return void send(st, room, { playerId: pick(rng, waiting) }, { type: 'ready' }, true);
    }
    case 'propose': {
      const leader = seats[g.leader % g.n];
      const size = QUEST_SIZES[g.n][g.quest];
      const r = rng();
      if (r < 0.04) return void send(st, room, { playerId: leader }, { type: 'propose', team: seats.slice(0, size - 1) }, false);
      if (r < 0.07) {
        const others = seats.filter((x) => x !== leader && !(x === H.playerId && room.mode.play === 'physical'));
        if (others.length) return void send(st, room, { playerId: pick(rng, others) }, { type: 'propose', team: shuffle(seats, rng).slice(0, size) }, false);
      }
      if (r < 0.10) return void send(st, room, H, { type: 'skip', id: leader }, true);
      return void send(st, room, { playerId: leader }, { type: 'propose', team: shuffle(seats, rng).slice(0, size) }, true);
    }
    case 'vote': {
      if (room.mode.votes === 'physical') {
        if (rng() < 0.05) return void send(st, room, any, { type: 'vote', approve: true }, false);
        return void send(st, room, H, { type: 'tally', approve: seats.filter(() => rng() < 0.6) }, true);
      }
      const todo = seats.filter((id) => !(id in g.votes));
      const r = rng();
      if (r < 0.04 && Object.keys(g.votes).length) return void send(st, room, { playerId: pick(rng, Object.keys(g.votes)) }, { type: 'vote', approve: true }, false);
      if (r < 0.07) return void send(st, room, H, { type: 'skip', id: pick(rng, todo) }, true);
      return void send(st, room, { playerId: pick(rng, todo) }, { type: 'vote', approve: rng() < 0.6 }, true);
    }
    case 'quest': {
      if (room.mode.cards === 'physical') {
        if (rng() < 0.05) return void send(st, room, { playerId: pick(rng, g.team) }, { type: 'play', sabotage: true }, false);
        if (rng() < 0.05) return void send(st, room, H, { type: 'questResult', fails: g.team.length + 1 }, false);
        const fails = Math.floor(rng() * (g.team.length + 1));
        st.intended = fails;
        return void send(st, room, H, { type: 'questResult', fails }, true);
      }
      const outsiders = seats.filter((x) => !g.team.includes(x));
      if (rng() < 0.04 && outsiders.length) return void send(st, room, { playerId: pick(rng, outsiders) }, { type: 'play', sabotage: false }, false);
      const who = pick(rng, g.team.filter((id) => !(id in g.cards)));
      if (rng() < 0.05) return void send(st, room, H, { type: 'skip', id: who }, true); // the host plays Success for them
      // A Loyal Servant's sabotage is not refused: it silently counts as Success. Only Evil sabotage (or any, with no roles dealt) counts.
      const counts = !g.roles || EVIL.has(g.roles[who]);
      const sab = counts ? rng() < st.sabP : rng() < 0.3;
      send(st, room, { playerId: who }, { type: 'play', sabotage: sab }, true);
      if (sab && counts) st.intended++;
      return;
    }
    case 'lantern': {
      const L = g.lantern;
      const cands = seats.filter((x) => x !== L.holder && !L.held.includes(x));
      const r = rng();
      if (!cands.length || r < 0.08) return void send(st, room, H, { type: 'skip', id: L.holder }, true);
      if (r < 0.12) return void send(st, room, { playerId: L.holder }, { type: 'examine', id: L.holder }, false);
      return void send(st, room, { playerId: L.holder }, { type: 'examine', id: pick(rng, cands) }, true);
    }
    case 'assassin': {
      if (!g.roles) {
        if (rng() < 0.1) return void send(st, room, H, { type: 'skip' }, false); // physical roles: the host enters the strike
        st.hit = rng() < 0.3;
        return void send(st, room, H, { type: 'strikeResult', id: pick(rng, seats), hit: st.hit }, true);
      }
      const asn = Object.keys(g.roles).find((k) => g.roles[k] === 'assassin');
      const r = rng();
      if (r < 0.1) return void send(st, room, { playerId: pick(rng, seats.filter((x) => x !== asn)) }, { type: 'strike', id: asn }, false);
      // An absent Assassin is struck at random from v2 on; a room still on version 1 keeps the old behaviour (refused).
      if (r < 0.2) return void send(st, room, H, { type: 'skip', id: asn }, (room.rulesVersion || 1) >= 2);
      return void send(st, room, { playerId: asn }, { type: 'strike', id: pick(rng, seats.filter((x) => x !== asn)) }, true);
    }
    default:
  }
}

// Every state the engine may be in, checked after each move.
function checkState(st, room) {
  const bad = (m) => st.rec.impossible.push(`${st.tag} [${st.steps}] ${m}`);
  if (!PHASES.includes(room.phase)) return bad(`unknown phase ${room.phase}`);
  const g = room.game;
  if (!g) { if (room.phase !== 'lobby') bad(`phase ${room.phase} with no game`); return; }
  if (room.phase === 'lobby') bad('a game is running in the lobby');
  const seats = seatIds(room);
  if (g.n !== st.n || seats.length !== g.n) bad(`${seats.length} seated for a ${g.n}-player deal`);
  if (g.roles) {
    if (Object.values(g.roles).sort().join() !== st.roleKey) bad('the deal does not match roleList');
    if (Object.values(g.roles).filter((r) => EVIL.has(r)).length !== EVIL_COUNT[g.n]) bad('Evil count is wrong');
  }
  if (g.roleSet.join() !== st.roleSetKey) bad('roleSet does not match the deal');
  if (g.results.length > 5 || g.results.some((r) => r !== 'success' && r !== 'fail')) bad('quest results are not success or fail');
  if (g.results.length !== g.quest || g.questFails.length !== g.results.length) bad('quest counter out of step with results');
  if (g.rejects < 0 || g.rejects > MAX_REJECTS) bad(`reject counter ${g.rejects}`);
  const size = g.quest < 5 ? QUEST_SIZES[g.n][g.quest] : 0;
  if ((room.phase === 'vote' || room.phase === 'quest') && g.team.length !== size) bad(`team of ${g.team.length} for a quest of ${size}`);
  if (room.phase === 'propose' && g.team.length > size) bad(`team of ${g.team.length} for a quest of ${size}`);
  if (g.team.some((id) => !seats.includes(id))) bad('a team member is not at the table');
  for (const [id, sab] of Object.entries(g.cards)) if (sab && g.roles && !EVIL.has(g.roles[id])) bad('a Loyal Servant’s sabotage was counted');
  if (room.phase === 'over') { if (!g.winner || !REASONS.includes(g.reason)) bad('game over without a winner'); }
  else if (g.winner || g.reason) bad('a winner before game over');
  if (g.lantern) {
    const L = g.lantern;
    if (new Set(L.held).size !== L.held.length || L.holder !== L.held[L.held.length - 1]) bad('the Lantern passed wrongly');
    for (const list of Object.values(L.seen)) for (const e of list) if (g.roles && side(g.roles[e.id]) !== e.side) bad('the Lantern showed the wrong side');
  }
  if (!sameIds(g.order, st.dealIds)) bad('the random order is not a permutation of the seats');
  if (g.roles && !sameIds(Object.keys(g.roles), seats)) bad('roles and seats disagree');
}

// Each quest's result, from the sabotage the sim actually played: the rule is one card, two at 7+ players on quest 4.
function resolvedChecks(st, room) {
  const g = room.game;
  while (st.nResults < g.results.length) {
    const i = st.nResults++;
    const need = g.n >= 7 && i === 3 ? 2 : 1;
    const want = st.intended >= need ? 'fail' : 'success';
    if (g.results[i] !== want || g.questFails[i] !== st.intended) st.rec.winner.push(`${st.tag}: quest ${i + 1} is ${g.results[i]} with ${g.questFails[i]} sabotage, expected ${want} with ${st.intended}`);
    st.intended = 0;
  }
}

// The winner, worked out from the quest results, the streak of rejected parties and the Assassin's pick.
function checkWinner(st, room) {
  const g = room.game;
  const oks = g.results.filter((r) => r === 'success').length;
  const fails = g.results.filter((r) => r === 'fail').length;
  let streak = 0;
  for (let i = g.history.length - 1; i >= 0 && !g.history[i].passed; i--) streak++;
  let winner; let reason;
  if (streak >= MAX_REJECTS) [winner, reason] = ['evil', 'rejects'];
  else if (fails >= 3) [winner, reason] = ['evil', 'quests'];
  else if (oks >= 3 && !st.hasAssassin) [winner, reason] = ['good', 'quests'];
  else if (oks >= 3) {
    const hit = g.roles ? g.roles[g.target] === 'merlin' : st.hit; // physical roles: the host's own entry decides
    [winner, reason] = hit ? ['evil', 'assassin'] : ['good', 'survived'];
  } else { st.rec.winner.push(`${st.tag}: the game ended before anyone won`); return; }
  if (g.winner !== winner || g.reason !== reason) st.rec.winner.push(`${st.tag}: expected ${winner} by ${reason}, the table says ${g.winner} by ${g.reason}`);
  st.rec.stats.winners[winner] = (st.rec.stats.winners[winner] || 0) + 1;
  st.rec.stats.reasons[reason] = (st.rec.stats.reasons[reason] || 0) + 1;
}

// Views: nothing a player should not know, the table screen shows no roles before the end, and reconnects see the same game.
function checkViews(st, room) {
  const g = room.game;
  const over = room.phase === 'over';
  const bad = (m) => st.rec.leaks.push(`${st.tag} [${st.steps}] ${m}`);
  const everyone = new Set(room.players.map((p) => p.id));
  const screen = viewForScreen(room, everyone);
  screen.game ||= {}; // no game yet: the view carries null
  if (!Object.keys(screen.game).every((k) => GAME_KEYS.has(k))) bad('the table screen carries an unlisted field');
  if (!over && (roleViewsIn(screen.game).length || 'evil' in screen.game || 'assassin' in screen.game)) bad('the table screen shows roles or the Evil team');
  for (const p of room.players) {
    const v = viewForPlayer(room, p.id, st.rng() < 0.5 ? everyone : new Set()); // a reconnect may see a different online set
    st.stats.views++;
    v.game ||= {};
    if (!Object.keys(v.game).every((k) => GAME_KEYS.has(k))) bad(`${p.name} carries an unlisted game field`);
    if (over) { if (g.roles && Object.keys(v.game.roles || {}).length !== g.n) bad('roles not shown at game over'); continue; }
    if (v.game.roles) bad(`${p.name} sees every role before game over`);
    const role = g && g.roles && g.roles[p.id];
    const mine = v.me?.role;
    if (!!mine !== !!(role && !p.watch) || (mine && mine.id !== role)) bad(`${p.name} sees the wrong role card`);
    const moderator = v.moderator ? Object.keys(v.moderator.roles).length : 0;
    if (v.moderator && !(p.host && p.watch && room.house.sitOut && g.roles)) bad(`${p.name} sees the whole deal`);
    const cards = roleViewsIn(v.me).length + roleViewsIn(v.game).length + roleViewsIn(v.moderator).length;
    if (cards !== (mine ? 1 : 0) + moderator) bad(`${p.name} has extra role cards`);
    const known = new Set(role && !p.watch ? expectedSees(p.id, g.roles, Object.keys(g.roles)).map((k) => k.id) : []);
    if ((v.me?.sees || []).some((k) => !known.has(k.id))) bad(`${p.name} is told about someone they should not know`);
    if (v.game.evil) {
      const evilKnows = room.phase === 'assassin' && role && EVIL.has(role) && role !== 'oberon';
      if (!evilKnows || v.game.evil.some((id) => id !== p.id && !known.has(id))) bad(`${p.name} is shown the Evil team beyond their card`);
      if (v.game.assassin && v.game.assassin !== p.id && !known.has(v.game.assassin)) bad(`${p.name} is shown the Assassin beyond their card`);
    }
    for (const e of v.me?.lanternSeen || []) if (side(g.roles[e.id]) !== e.side) bad(`${p.name} has the Lantern wrong`);
  }
}

function playGame(index, rng, rec) {
  const c = caseFor(index);
  const room = newRoom(`SIM${index}`, HOST_KEY);
  const st = { rec, rng, stats: rec.stats, tag: `game ${index} (${c.n} players)`, n: c.n, steps: 0, late: 1,
    sabP: [0.1, 0.4, 0.8][index % 3], intended: 0, nResults: 0, hit: null, dealIds: [], roleKey: '', roleSetKey: '', hasAssassin: false,
    legacy: rng() < 0.2, lastPhase: null };
  rec.stats.games++;
  for (let i = 0; i < c.n; i++) send(st, room, {}, { type: 'join', name: `P${i}`, hostKey: i === 0 ? HOST_KEY : undefined }, true);
  const H = hostOf(room);
  send(st, room, H, { type: 'mode', mode: c.mode }, true);
  send(st, room, H, { type: 'house', house: { lantern: c.lantern } }, true);
  send(st, room, H, { type: 'settings', settings: c.settings }, true);
  deal(st, room);
  // A room that was started before the rules were pinned: no rulesVersion, so it keeps version 1 until Restart or Play again.
  if (st.legacy) { delete room.rulesVersion; rec.stats.legacy++; }
  let deals = 1;
  for (let i = 0; ; i++) {
    if (room.phase === 'over') {
      checkWinner(st, room);
      checkViews(st, room);
      if (deals >= MAX_DEALS || rng() < 0.4) break;
      deals++;
      kickWatchers(st, room);
      if (!(rng() < 0.5 && restart(st, room))) again(st, room);
      continue;
    }
    if (i >= MAX_STEPS) { rec.impossible.push(`${st.tag}: no finish in ${MAX_STEPS} steps`); break; }
    st.steps = i;
    step(st, room);
    if (room.game) resolvedChecks(st, room);
    checkState(st, room);
    // Views change most when roles can show: at the reveal, the Assassin's turn, the Lantern and the end.
    const reveals = room.phase !== st.lastPhase && ['reveal', 'assassin', 'lantern', 'over'].includes(room.phase);
    if (reveals || rng() < 0.03) checkViews(st, room);
    st.lastPhase = room.phase;
  }
}

let RESULT = null;
function simulate() {
  if (RESULT) return RESULT;
  const rec = { impossible: [], leaks: [], knowledge: [], winner: [], restart: [],
    stats: { games: 0, moves: 0, illegal: 0, restarts: 0, refusedRestarts: 0, views: 0, legacy: 0, reasons: {}, winners: {},
      percivalFirst: { merlin: 0, morgana: 0 } } };
  const rng = lcg(SEED);
  for (let g = 0; g < GAMES; g++) playGame(g, rng, rec);
  RESULT = rec;
  return rec;
}

test('sim: no impossible states', () => {
  const rec = simulate();
  assert.deepEqual(rec.impossible.slice(0, 10), [], `${rec.impossible.length} problems`);
  assert.ok(rec.stats.moves > GAMES * 20, 'the games were too short to mean much');
  assert.ok(rec.stats.illegal > GAMES, 'illegal moves were barely tried');
});

test('sim: right winner', () => {
  const rec = simulate();
  assert.deepEqual(rec.winner.slice(0, 10), [], `${rec.winner.length} problems`);
  for (const r of REASONS) assert.ok(rec.stats.reasons[r] > 0, `no game ended by ${r}`);
});

test('sim: knowledge correct', () => {
  const rec = simulate();
  assert.deepEqual(rec.knowledge.slice(0, 10), [], `${rec.knowledge.length} problems`);
  const { merlin, morgana } = rec.stats.percivalFirst;
  assert.ok(merlin > 50 && morgana > 50, `Percival's two candidates should come up in both orders (${merlin} Merlin first, ${morgana} Morgana first)`);
});

test('sim: no leaks', () => {
  const rec = simulate();
  assert.deepEqual(rec.leaks.slice(0, 10), [], `${rec.leaks.length} problems`);
  assert.ok(rec.stats.views > GAMES * 5, 'too few views checked');
});

test('sim: restart resets', () => {
  const rec = simulate();
  assert.deepEqual(rec.restart.slice(0, 10), [], `${rec.restart.length} problems`);
  assert.ok(rec.stats.restarts > 0 && rec.stats.refusedRestarts > 0, 'Restart was barely exercised, or never refused');
});
