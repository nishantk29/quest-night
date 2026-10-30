// Quest Night room: the game reducer and the per-viewer projections. Table things (chat, tools, host
// controls, play modes) come from table.js. Secrecy lives in viewForPlayer / viewForScreen.
import { ROLES, SIDES, QUEST_SIZES, MIN_PLAYERS, MAX_PLAYERS, MAX_REJECTS, failsNeeded, roleList, shuffle,
  knowledgeFor, proposalPasses, questWinner, cleanSettings, DEFAULT_SETTINGS, LANTERN_AFTER, HOUSE_DEFAULTS, sideOf } from './rules.js';
import { newTable, reduceTable, tableView, onPhaseChange, modeProblem, log, byId, seated, seatIds } from './table.js';

// Open rooms keep the rules they started with: a room without rulesVersion is version 1 (never backfilled). A new
// room, a fresh start, Restart and Play again all move to the latest. Rule-affecting fixes are gated on
// (room.rulesVersion || 1) >= 2.
export const LATEST_RULES_VERSION = 2;
export const rulesVersion = (room) => room.rulesVersion || 1;

export function newRoom(code, hostKey) {
  const room = newTable(code, hostKey, DEFAULT_SETTINGS, HOUSE_DEFAULTS);
  room.rulesVersion = LATEST_RULES_VERSION; room.gameNo = 1;
  return room;
}

const ok = (data = {}) => ({ ok: true, data });
const err = (error) => ({ error });
const HOOKS = { minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, houseDefaults: HOUSE_DEFAULTS };
const GAME = new Set(['propose', 'vote', 'tally', 'play', 'questResult', 'examine', 'skip', 'strike', 'strikeResult', 'pick', 'ready', 'skipReveal']);

const seat = seatIds;
const leaderId = (room) => seat(room)[room.game.leader % room.game.n];
const nextLeader = (room) => { room.game.leader = (room.game.leader + 1) % room.game.n; };
const nm = (room, id) => byId(room, id)?.name || '?';
const nms = (room, ids) => ids.map((id) => nm(room, id)).join(', ');
const appRoles = (room) => room.mode.roles === 'app';

function finish(room, winner, reason, now) {
  room.game.winner = winner; room.game.reason = reason; room.phase = 'over';
  log(room, 'game', winner === 'good' ? 'The Loyal Servants of Arthur win.' : 'The Minions of Mordred win.', null, now);
}

function startGame(room, rng, now, restart = false) {
  const ids = seat(room);
  const list = roleList(ids.length, room.settings);
  if (list.error) return err(list.error);
  const mp = modeProblem(room); if (mp) return err(mp);
  let roles = null;
  if (appRoles(room)) { const dealt = shuffle(list.roles, rng); roles = {}; ids.forEach((id, i) => { roles[id] = dealt[i]; }); }
  const n = ids.length;
  const hostSeat = ids.indexOf(room.players.find((p) => p.host)?.id);
  const leader = room.house.firstLeader === 'host' && hostSeat >= 0 ? hostSeat : Math.floor(rng() * n);
  room.game = {
    roles, n, sizes: QUEST_SIZES[n], roleSet: [...new Set(list.roles)].sort(),
    results: [], questFails: [], quest: 0, rejects: 0, leader,
    team: [], votes: {}, cards: {}, ready: {}, history: [], lastVote: null, lastQuest: null,
    winner: null, reason: null, target: null, lantern: null,
    order: shuffle(ids, rng), // the game's own random order for every "who you see" list (never sent to a client)
  };
  if (room.house.lantern) { const h = ids[(leader - 1 + n) % n]; room.game.lantern = { holder: h, held: [h], checks: [], seen: {} }; }
  room.phase = 'reveal';
  room.undo = [];
  if (restart) { // a clean slate: nothing from the old game survives
    room.log = []; room.logN = 0; room.timer = null; room.talk = null; room.paused = null; room.poll = null;
    room.counters = []; room.nudges = {};
  }
  room.rulesVersion = LATEST_RULES_VERSION;
  room.gameNo = (room.gameNo || 1) + 1;
  log(room, 'game', `${restart ? 'Restarted: ' : 'New game: '}${n} players, ${n - list.roles.filter((r) => sideOf(r) === 'evil').length} Loyal and ${list.roles.filter((r) => sideOf(r) === 'evil').length} Evil.`, null, now);
  return ok();
}

function resolveVote(room, now) {
  const g = room.game;
  const approve = seat(room).filter((id) => g.votes[id]);
  const reject = seat(room).filter((id) => !g.votes[id]);
  const passed = proposalPasses(approve.length, g.n);
  const rec = { quest: g.quest, attempt: g.rejects + 1, leader: leaderId(room), team: [...g.team], approve, reject, passed };
  g.history.push(rec); g.lastVote = rec; g.votes = {};
  log(room, 'game', `Party ${passed ? 'approved' : 'rejected'} ${approve.length}–${reject.length}${room.house.anonVotes ? '' : ` (approve: ${nms(room, approve) || 'nobody'})`}.`, null, now);
  if (passed) { g.cards = {}; room.phase = 'quest'; return; }
  g.rejects += 1;
  if (g.rejects >= MAX_REJECTS) { finish(room, 'evil', 'rejects', now); return; }
  g.team = []; nextLeader(room); room.phase = 'propose';
}

function resolveQuest(room, fails, now) {
  const g = room.game;
  const need = failsNeeded(g.n, g.quest);
  const result = fails >= need ? 'fail' : 'success';
  g.results.push(result); g.questFails.push(fails);
  g.lastQuest = { quest: g.quest, fails, need, result, size: g.team.length };
  log(room, 'game', `Quest ${g.quest + 1} ${result === 'success' ? 'succeeded' : 'failed'}: ${fails} sabotage card${fails === 1 ? '' : 's'}.`, null, now);
  g.cards = {}; g.team = []; g.rejects = 0; g.quest += 1; nextLeader(room);
  const w = questWinner(g.results);
  if (w === 'evil') finish(room, 'evil', 'quests', now);
  else if (w === 'good') {
    if (g.roleSet.includes('assassin')) room.phase = 'assassin';
    else finish(room, 'good', 'quests', now);
  } else if (g.lantern && LANTERN_AFTER.includes(g.results.length)) room.phase = 'lantern';
  else room.phase = 'propose';
}

function gameReduce(room, actor, msg, rng, now) {
  const me = actor.playerId ? byId(room, actor.playerId) : null;
  const isHost = !!me?.host;
  const g = room.game;
  const seatedMe = me && !me.watch ? me : null;

  switch (msg.type) {
    case 'settings': {
      if (!isHost) return err('Only the host can change the roles.');
      if (room.phase !== 'lobby') return err('Roles are locked once the game starts.');
      room.settings = cleanSettings({ ...room.settings, ...(msg.settings || {}) });
      return ok();
    }
    case 'start': {
      if (!isHost) return err('Only the host can deal.');
      if (room.phase !== 'lobby') return err('The game has already started.');
      return startGame(room, rng, now);
    }
    case 'restart': { // host: a fresh deal for the same table, straight into the reveal
      if (!isHost) return err('Only the host can restart.');
      if (room.phase === 'lobby') return err('Nothing to restart yet.');
      // Watchers who joined mid-game get a seat, exactly like Play again.
      const was = room.players.map((p) => p.watch);
      for (const p of room.players) p.watch = !!(p.host && room.house.sitOut);
      const res = startGame(room, rng, now, true);
      if (res.error) { room.players.forEach((p, i) => { p.watch = was[i]; }); return res; }
      return res;
    }
    case 'ready': {
      if (room.phase !== 'reveal' || !seatedMe) return err('Not now.');
      g.ready[me.id] = true;
      if (seat(room).every((id) => g.ready[id] || byId(room, id).phoneless)) room.phase = 'propose';
      return ok();
    }
    case 'skipReveal': {
      if (!isHost || room.phase !== 'reveal') return err('Not now.');
      room.phase = 'propose'; return ok();
    }
    case 'pick': {
      if (room.phase !== 'propose') return err('It isn’t time to choose a team.');
      const lead = leaderId(room);
      if (!me || (lead !== me.id && !(isHost && byId(room, lead).phoneless))) return err('Only the leader chooses the team.');
      if (!seat(room).includes(msg.id)) return err('No such player.');
      const size = g.sizes[g.quest];
      if (g.team.includes(msg.id)) g.team = g.team.filter((x) => x !== msg.id);
      else if (g.team.length >= size) return err(`This quest takes ${size}. Take someone off first.`);
      else g.team = [...g.team, msg.id];
      return ok();
    }
    case 'propose': {
      if (room.phase !== 'propose') return err('It isn’t time to propose.');
      const lead = leaderId(room);
      if (!me || (lead !== me.id && !(isHost && (byId(room, lead).phoneless || room.mode.play === 'physical')))) return err('Only the leader proposes the team.');
      const size = g.sizes[g.quest];
      if (Array.isArray(msg.team)) {
        const t = [...new Set(msg.team)].filter((id) => seat(room).includes(id));
        if (t.length !== msg.team.length) return err('That team has someone who isn’t playing.');
        if (t.length !== size) return err(`Choose exactly ${size} for this quest.`);
        g.team = t;
      }
      if (g.team.length !== size) return err(`Choose exactly ${size} for this quest.`);
      g.votes = {}; room.phase = 'vote';
      log(room, 'game', `Quest ${g.quest + 1}, party ${g.rejects + 1}: ${nm(room, lead)} proposed ${nms(room, g.team)}.`, null, now);
      return ok();
    }
    case 'vote': {
      if (room.phase !== 'vote') return err('There is no vote right now.');
      if (room.mode.votes !== 'app') return err('Votes are counted at the table in this game.');
      if (!seatedMe) return err('Only players at the table vote.');
      if (typeof msg.approve !== 'boolean') return err('Vote approve or reject.');
      if (me.id in g.votes) return err('You have already voted.');
      g.votes[me.id] = msg.approve;
      if (Object.keys(g.votes).length >= g.n) resolveVote(room, now);
      return ok();
    }
    case 'tally': { // physical votes: the host taps who approved (votes are public in this game)
      if (!isHost) return err('Only the host enters the table’s votes.');
      if (room.phase !== 'vote') return err('There is no vote right now.');
      if (room.mode.votes !== 'physical') return err('Votes are cast in the app in this game.');
      const yes = new Set(Array.isArray(msg.approve) ? msg.approve : []);
      g.votes = Object.fromEntries(seat(room).map((id) => [id, yes.has(id)]));
      resolveVote(room, now); return ok();
    }
    case 'play': {
      if (room.phase !== 'quest') return err('No quest is under way.');
      if (room.mode.cards !== 'app') return err('Quest cards are played at the table in this game.');
      if (!me || !g.team.includes(me.id)) return err('Only the quest team plays cards.');
      if (me.id in g.cards) return err('You have already played your card.');
      // A Loyal Servant's Sabotage silently counts as Success: no error, so their phone moves on exactly like everyone's.
      const sabotage = !!msg.sabotage && !(g.roles && sideOf(g.roles[me.id]) === 'good');
      g.cards[me.id] = sabotage;
      if (Object.keys(g.cards).length >= g.team.length) resolveQuest(room, Object.values(g.cards).filter(Boolean).length, now);
      return ok();
    }
    case 'questResult': { // physical quest cards: the host enters how many sabotage cards were turned up
      if (!isHost) return err('Only the host enters the quest result.');
      if (room.phase !== 'quest') return err('No quest is under way.');
      if (room.mode.cards !== 'physical') return err('Quest cards are played in the app in this game.');
      const f = Math.round(Number(msg.fails));
      if (!(f >= 0 && f <= g.team.length)) return err(`Between 0 and ${g.team.length} sabotage cards.`);
      resolveQuest(room, f, now); return ok();
    }
    case 'examine': { // the Lantern
      if (room.phase !== 'lantern') return err('The Lantern is not in use now.');
      const L = g.lantern;
      const holderPhys = !appRoles(room) || byId(room, L.holder).phoneless;
      if (!me || (me.id !== L.holder && !(isHost && holderPhys))) return err('Only the Lantern holder chooses.');
      if (!seat(room).includes(msg.id) || msg.id === L.holder) return err('Choose another player.');
      if (L.held.includes(msg.id)) return err('That player has held the Lantern already.');
      const check = { by: L.holder, id: msg.id, after: g.results.length };
      L.checks.push(check);
      if (g.roles) (L.seen[L.holder] ||= []).push({ id: msg.id, side: sideOf(g.roles[msg.id]) });
      log(room, 'game', `${nm(room, L.holder)} used the Lantern on ${nm(room, msg.id)}${g.roles ? '' : ' (they show their loyalty card in secret)'}. The Lantern passes to ${nm(room, msg.id)}.`, null, now);
      L.holder = msg.id; L.held.push(msg.id);
      room.phase = 'propose'; return ok();
    }
    case 'strike': {
      if (room.phase !== 'assassin') return err('Not now.');
      if (!g.roles) return err('Roles are physical: the host enters the strike.');
      if (!me || g.roles[me.id] !== 'assassin') return err('Only the Assassin strikes.');
      const t = byId(room, msg.id);
      // Any other player may be named: a refusal would tell the Assassin a side (Oberon is Evil but unknown to them).
      if (!t || !seat(room).includes(t.id) || t.id === me.id) return err('Choose another player.');
      g.target = t.id;
      log(room, 'game', `The Assassin struck ${t.name}.`, null, now);
      if (g.roles[t.id] === 'merlin') finish(room, 'evil', 'assassin', now); else finish(room, 'good', 'survived', now);
      return ok();
    }
    case 'strikeResult': { // physical roles: the host enters who was named and whether they were Merlin
      if (!isHost || room.phase !== 'assassin') return err('Not now.');
      if (g.roles) return err('The Assassin strikes on their own phone.');
      if (!seat(room).includes(msg.id)) return err('Choose who the Assassin named.');
      g.target = msg.id;
      log(room, 'game', `The Assassin named ${nm(room, msg.id)}, who ${msg.hit ? 'was' : 'was not'} Merlin.`, null, now);
      if (msg.hit) finish(room, 'evil', 'assassin', now); else finish(room, 'good', 'survived', now);
      return ok();
    }
    case 'skip': { // host tool: move an idle player along with the most neutral choice, in the open
      if (!isHost) return err('Only the host can skip a player.');
      const p = byId(room, msg.id);
      if (room.phase === 'reveal') { if (!p) return err('No such player.'); g.ready[p.id] = true; if (seat(room).every((id) => g.ready[id] || byId(room, id).phoneless)) room.phase = 'propose'; return ok(); }
      if (room.phase === 'vote') {
        if (!p || !seat(room).includes(p.id) || p.id in g.votes) return err('That player has voted already.');
        g.votes[p.id] = false; log(room, 'host', `The host skipped ${p.name}’s vote (counted as reject).`, null, now);
        if (Object.keys(g.votes).length >= g.n) resolveVote(room, now); return ok();
      }
      if (room.phase === 'quest') {
        if (!p || !g.team.includes(p.id) || p.id in g.cards) return err('That player has played already.');
        g.cards[p.id] = false; log(room, 'host', `The host played Success for ${p.name}.`, null, now);
        if (Object.keys(g.cards).length >= g.team.length) resolveQuest(room, Object.values(g.cards).filter(Boolean).length, now); return ok();
      }
      if (room.phase === 'propose') { log(room, 'host', `The host passed the crown on from ${nm(room, leaderId(room))}.`, null, now); g.team = []; nextLeader(room); return ok(); }
      if (room.phase === 'assassin' && rulesVersion(room) >= 2) { // an absent Assassin: a random strike at someone else, in the open
        if (!g.roles) { // physical roles: the app cannot know Merlin, so the Assassin simply does not strike and the Servants survive
          g.target = null;
          log(room, 'host', 'The host skipped the Assassin: no strike was made.', null, now);
          finish(room, 'good', 'unstruck', now);
          return ok();
        }
        const pool = seat(room).filter((id) => g.roles[id] !== 'assassin');
        const t = byId(room, pool[Math.floor(rng() * pool.length)]);
        g.target = t.id;
        log(room, 'host', `The host skipped the Assassin: the strike falls on ${t.name} at random.`, null, now);
        if (g.roles[t.id] === 'merlin') finish(room, 'evil', 'assassin', now); else finish(room, 'good', 'survived', now);
        return ok();
      }
      if (room.phase === 'lantern') { log(room, 'host', 'The host skipped the Lantern this round.', null, now); room.phase = 'propose'; return ok(); }
      return err('Nothing to skip now.');
    }
    case 'again': case 'abandon': {
      if (!isHost) return err('Only the host can do that.');
      if (msg.type === 'again' && room.phase !== 'over') return err('Finish this game first.');
      for (const p of room.players) p.watch = !!(p.host && room.house.sitOut); // late watchers get a seat in the next game
      room.game = null; room.phase = 'lobby'; room.undo = []; room.timer = null; room.talk = null; room.paused = null;
      if (msg.type === 'abandon') log(room, 'host', 'The host ended the game.', null, now);
      return ok();
    }
    case 'close': { // host: close the room for everyone; the Worker then wipes it and frees the code
      if (!isHost) return err('Only the host can do that.');
      room.closed = true;
      return ok();
    }
    default: return err('Unknown action.');
  }
}

export function reduce(room, actor, msg, rng = Math.random, now = Date.now()) {
  if (!msg || typeof msg.type !== 'string') return err('Bad message.');
  const before = room.phase;
  const t = reduceTable(room, actor, msg, rng, now, HOOKS);
  if (t) return t;
  if (room.paused && GAME.has(msg.type)) return err('The game is paused.');
  if (GAME.has(msg.type) && !room.game) return err('No game is running.');
  const res = gameReduce(room, actor, msg, rng, now);
  if (res.ok && room.phase !== before) onPhaseChange(room, now);
  return res;
}

// ---------------------------------------------------------------- views
const roleView = (id) => { const r = ROLES[id]; return { id: r.id, name: r.name, side: r.side, sideName: SIDES[r.side].name, blurb: r.blurb, icon: r.icon }; };

function publicGame(room) {
  const g = room.game;
  if (!g) return null;
  const anon = room.house.anonVotes;
  const hist = (h) => h && ({ ...h, yes: h.approve.length, no: h.reject.length, approve: anon ? [] : h.approve, reject: anon ? [] : h.reject });
  return {
    n: g.n, sizes: g.sizes, needs: g.sizes.map((_, i) => failsNeeded(g.n, i)),
    results: g.results, questFails: g.questFails, quest: g.quest, rejects: g.rejects, maxRejects: MAX_REJECTS,
    leader: leaderId(room), team: g.team,
    voted: room.phase === 'vote' ? seat(room).filter((id) => id in g.votes) : [],
    played: room.phase === 'quest' ? g.team.filter((id) => id in g.cards) : [],
    ready: room.phase === 'reveal' ? seat(room).filter((id) => g.ready[id]) : [],
    history: g.history.map(hist), lastVote: hist(g.lastVote), lastQuest: g.lastQuest,
    roleSet: g.roleSet, appRoles: !!g.roles,
    lantern: g.lantern ? { holder: g.lantern.holder, held: g.lantern.held, checks: g.lantern.checks } : null,
    winner: g.winner, reason: g.reason, target: g.target,
  };
}

function endReveal(room, view, viewerId = null) {
  const g = room.game;
  // Before the strike only Evil players may see the Evil team, and only as far as their own card knows it:
  // nobody learns who Oberon is, and Oberon learns no one. Good players and the table screen see nothing.
  if (g && room.phase === 'assassin' && g.roles && viewerId && g.roles[viewerId] && sideOf(g.roles[viewerId]) === 'evil' && g.roles[viewerId] !== 'oberon') {
    const known = new Set([viewerId, ...knowledgeFor(viewerId, g.roles, g.order).map((k) => k.id)]);
    view.game.evil = seat(room).filter((id) => known.has(id));
    view.game.assassin = view.game.evil.find((id) => g.roles[id] === 'assassin');
  }
  if (g && room.phase === 'over' && g.roles) view.game.roles = Object.fromEntries(seat(room).map((id) => [id, roleView(g.roles[id])]));
}

export function viewForPlayer(room, playerId, connected = new Set()) {
  const view = { kind: 'player', ...tableView(room, playerId, connected), rulesVersion: rulesVersion(room), game: publicGame(room) };
  const me = byId(room, playerId);
  const g = room.game;
  if (g && me && !me.watch && g.roles && g.roles[me.id]) {
    view.me.role = roleView(g.roles[me.id]);
    view.me.sees = knowledgeFor(me.id, g.roles, g.order);
    if (g.lantern?.seen[me.id]) view.me.lanternSeen = g.lantern.seen[me.id];
  }
  if (g && me && room.phase === 'vote' && me.id in g.votes) view.me.vote = g.votes[me.id];
  if (g && me && room.phase === 'quest' && me.id in g.cards) view.me.played = true;
  // A storyteller who sits out is the moderator: they see the whole deal on their own phone.
  if (g && me?.host && me.watch && room.house.sitOut && g.roles) view.moderator = { roles: Object.fromEntries(seat(room).map((id) => [id, roleView(g.roles[id])])) };
  endReveal(room, view, playerId);
  return view;
}

// The game-over event, sent once by the server to every connected client when the game ends. Everything in
// it is public except `won`, which is computed here for that one player's own socket (null for the table
// screen, storytellers and physical-card tables, where the server doesn't know who is who).
export function gameOverEvent(room, playerId = null) {
  const g = room.game;
  if (!g || room.phase !== 'over') return null;
  const nm = (id) => room.players.find((p) => p.id === id)?.name || 'Merlin';
  const text = { rejects: 'Five parties in a row were rejected', quests: g.winner === 'good' ? 'Three quests succeeded' : 'Three quests were sabotaged',
    assassin: `The Assassin named ${nm(g.target)}, Merlin`, survived: `The Assassin named ${nm(g.target)}, who was not Merlin`, unstruck: 'The Assassin made no strike' }[g.reason] || '';
  const me = playerId && g.roles ? byId(room, playerId) : null;
  const mine = me && !me.watch && g.roles[me.id] ? sideOf(g.roles[me.id]) : null;
  return { type: 'gameover', winner: g.winner, winnerName: g.winner === 'good' ? 'The Loyal Servants of Arthur' : 'The Minions of Mordred', reason: g.reason, text, won: mine ? mine === g.winner : null };
}

// The shared table screen (TV or laptop): public information only, always.
export function viewForScreen(room, connected = new Set()) {
  const view = { kind: 'screen', ...tableView(room, null, connected), game: publicGame(room) };
  endReveal(room, view);
  return view;
}
