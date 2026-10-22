// Quest Night room: state, the reducer for every action, and the per-player views.
// Shared by the Durable Object (authoritative) and the tests. Secrecy lives in viewForPlayer.
import { ROLES, SIDES, QUEST_SIZES, MIN_PLAYERS, MAX_PLAYERS, MAX_REJECTS, failsNeeded, roleList, shuffle,
  knowledgeFor, proposalPasses, questWinner, cleanSettings, DEFAULT_SETTINGS } from './rules.js';

const MAX_NAME = 20;
const randToken = (rng) => Array.from({ length: 24 }, () => Math.floor(rng() * 16).toString(16)).join('');

export function newRoom(code, hostKey) {
  return { code, hostKey, created: Date.now(), updated: Date.now(), phase: 'lobby',
    players: [], settings: { ...DEFAULT_SETTINGS }, game: null, nextId: 1 };
}

const ok = (data) => ({ ok: true, data });
const err = (error) => ({ error });
const byId = (room, id) => room.players.find((p) => p.id === id);
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

function startGame(room, rng) {
  const ids = room.players.map((p) => p.id);
  const list = roleList(ids.length, room.settings);
  if (list.error) return err(list.error);
  const dealt = shuffle(list.roles, rng);
  const roles = {};
  ids.forEach((id, i) => { roles[id] = dealt[i]; });
  room.game = {
    roles, n: ids.length, sizes: QUEST_SIZES[ids.length],
    results: [], questFails: [], quest: 0, rejects: 0,
    leader: Math.floor(rng() * ids.length), // index into seat order
    team: [], votes: {}, cards: {}, ready: {},
    history: [], // [{ quest, leader, team, approve, reject, passed }]
    lastVote: null, lastQuest: null, winner: null, reason: null, target: null,
  };
  room.phase = 'reveal';
  return ok({});
}

const seat = (room) => room.players.map((p) => p.id);
const leaderId = (room) => seat(room)[room.game.leader % room.players.length];
const nextLeader = (room) => { room.game.leader = (room.game.leader + 1) % room.players.length; };

function finish(room, winner, reason) { room.game.winner = winner; room.game.reason = reason; room.phase = 'over'; }

export function reduce(room, actor, msg, rng = Math.random) {
  if (!msg || typeof msg.type !== 'string') return err('Bad message.');
  const me = actor.playerId ? byId(room, actor.playerId) : null;
  const isHost = !!me?.host;
  const g = room.game;

  switch (msg.type) {
    case 'join': {
      const name = cleanName(msg.name);
      if (!name) return err('Type your name first.');
      if (room.phase !== 'lobby') return err('This game has already started. Ask the host to start a new one.');
      if (room.players.length >= MAX_PLAYERS) return err(`The table is full (${MAX_PLAYERS} players).`);
      if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return err('Someone at the table already has that name.');
      const host = !!msg.hostKey && msg.hostKey === room.hostKey && !room.players.some((p) => p.host);
      const p = { id: `p${room.nextId++}`, name, token: randToken(rng), host };
      room.players.push(p);
      return ok({ playerId: p.id, token: p.token });
    }

    case 'settings': {
      if (!isHost) return err('Only the host can change the roles.');
      if (room.phase !== 'lobby') return err('Roles are locked once the game starts.');
      room.settings = cleanSettings({ ...room.settings, ...(msg.settings || {}) });
      return ok({});
    }

    case 'kick': {
      if (!isHost) return err('Only the host can remove players.');
      if (room.phase !== 'lobby') return err('Players can only be removed in the lobby.');
      const p = byId(room, msg.id);
      if (!p || p.host) return err('That player can’t be removed.');
      room.players = room.players.filter((x) => x.id !== msg.id);
      return ok({});
    }

    case 'move': { // seat order is the leader order, so let the host match the real table
      if (!isHost) return err('Only the host can change the seating.');
      if (room.phase !== 'lobby') return err('Seats are fixed once the game starts.');
      const i = room.players.findIndex((p) => p.id === msg.id);
      const j = i + (msg.dir === 'up' ? -1 : 1);
      if (i < 0 || j < 0 || j >= room.players.length) return err('Can’t move that seat.');
      [room.players[i], room.players[j]] = [room.players[j], room.players[i]];
      return ok({});
    }

    case 'start': {
      if (!isHost) return err('Only the host can start.');
      if (room.phase !== 'lobby') return err('The game has already started.');
      if (room.players.length < MIN_PLAYERS) return err(`You need at least ${MIN_PLAYERS} players.`);
      return startGame(room, rng);
    }

    case 'ready': { // done looking at your secret card
      if (room.phase !== 'reveal' || !me) return err('Not now.');
      g.ready[me.id] = true;
      if (room.players.every((p) => g.ready[p.id])) room.phase = 'propose';
      return ok({});
    }

    case 'skipReveal': { // host can move on if someone wandered off
      if (!isHost || room.phase !== 'reveal') return err('Not now.');
      room.phase = 'propose';
      return ok({});
    }

    case 'pick': { // leader toggles a knight on or off the proposed team
      if (room.phase !== 'propose') return err('It isn’t time to choose a team.');
      if (!me || leaderId(room) !== me.id) return err('Only the leader chooses the team.');
      if (!byId(room, msg.id)) return err('No such player.');
      const size = g.sizes[g.quest];
      if (g.team.includes(msg.id)) g.team = g.team.filter((x) => x !== msg.id);
      else if (g.team.length >= size) return err(`This quest takes ${size}. Take someone off first.`);
      else g.team = [...g.team, msg.id];
      return ok({});
    }

    case 'propose': {
      if (room.phase !== 'propose') return err('It isn’t time to propose.');
      if (!me || leaderId(room) !== me.id) return err('Only the leader proposes the team.');
      const size = g.sizes[g.quest];
      if (Array.isArray(msg.team)) {
        const t = [...new Set(msg.team)].filter((id) => byId(room, id));
        if (t.length !== msg.team.length) return err('That team has someone who isn’t playing.');
        if (t.length !== size) return err(`Choose exactly ${size} for this quest.`);
        g.team = t;
      }
      if (g.team.length !== size) return err(`Choose exactly ${size} for this quest.`);
      g.votes = {};
      room.phase = 'vote';
      return ok({});
    }

    case 'vote': {
      if (room.phase !== 'vote') return err('There is no vote right now.');
      if (!me) return err('Join the table first.');
      if (typeof msg.approve !== 'boolean') return err('Vote approve or reject.');
      if (me.id in g.votes) return err('You have already voted.');
      g.votes[me.id] = msg.approve;
      if (Object.keys(g.votes).length < room.players.length) return ok({});
      const approve = seat(room).filter((id) => g.votes[id]);
      const reject = seat(room).filter((id) => !g.votes[id]);
      const passed = proposalPasses(approve.length, room.players.length);
      const rec = { quest: g.quest, attempt: g.rejects + 1, leader: leaderId(room), team: [...g.team], approve, reject, passed };
      g.history.push(rec);
      g.lastVote = rec;
      g.votes = {};
      if (passed) { g.cards = {}; room.phase = 'quest'; return ok({}); }
      g.rejects += 1;
      if (g.rejects >= MAX_REJECTS) { finish(room, 'shadow', 'rejects'); return ok({}); }
      g.team = [];
      nextLeader(room);
      room.phase = 'propose';
      return ok({});
    }

    case 'play': { // a quest member plays success or sabotage, face down
      if (room.phase !== 'quest') return err('No quest is under way.');
      if (!me || !g.team.includes(me.id)) return err('Only the quest team plays cards.');
      if (me.id in g.cards) return err('You have already played your card.');
      const sabotage = !!msg.sabotage;
      if (sabotage && ROLES[g.roles[me.id]].side === 'loyal') return err('The Loyal can only play Success.');
      g.cards[me.id] = sabotage;
      if (Object.keys(g.cards).length < g.team.length) return ok({});
      const fails = Object.values(g.cards).filter(Boolean).length;
      const need = failsNeeded(g.n, g.quest);
      const result = fails >= need ? 'fail' : 'success';
      g.results.push(result);
      g.questFails.push(fails);
      g.lastQuest = { quest: g.quest, fails, need, result, size: g.team.length };
      g.cards = {};
      g.team = [];
      g.rejects = 0;
      g.quest += 1;
      nextLeader(room);
      const w = questWinner(g.results);
      if (w === 'shadow') finish(room, 'shadow', 'quests');
      else if (w === 'loyal') {
        if (Object.values(g.roles).includes('assassin')) room.phase = 'assassin';
        else finish(room, 'loyal', 'quests');
      } else room.phase = 'propose';
      return ok({});
    }

    case 'strike': {
      if (room.phase !== 'assassin') return err('Not now.');
      if (!me || g.roles[me.id] !== 'assassin') return err('Only the Assassin strikes.');
      const t = byId(room, msg.id);
      if (!t || ROLES[g.roles[t.id]].side !== 'loyal') return err('Choose one of the players you believe is Loyal.');
      g.target = t.id;
      if (g.roles[t.id] === 'seer') finish(room, 'shadow', 'assassin');
      else finish(room, 'loyal', 'survived');
      return ok({});
    }

    case 'again': {
      if (!isHost) return err('Only the host can start a new game.');
      if (room.phase !== 'over') return err('Finish this game first.');
      room.game = null;
      room.phase = 'lobby';
      return ok({});
    }

    case 'abandon': {
      if (!isHost) return err('Only the host can end the game.');
      room.game = null;
      room.phase = 'lobby';
      return ok({});
    }

    default: return err('Unknown action.');
  }
}

// ---------------------------------------------------------------- views
const roleView = (id) => { const r = ROLES[id]; return { id: r.id, name: r.name, side: r.side, sideName: SIDES[r.side].name, blurb: r.blurb, icon: r.icon }; };

function publicGame(room) {
  const g = room.game;
  if (!g) return null;
  return {
    n: g.n, sizes: g.sizes, needs: g.sizes.map((_, i) => failsNeeded(g.n, i)),
    results: g.results, questFails: g.questFails, quest: g.quest, rejects: g.rejects, maxRejects: MAX_REJECTS,
    leader: leaderId(room), team: g.team,
    voted: room.phase === 'vote' ? seat(room).filter((id) => id in g.votes) : [],
    played: room.phase === 'quest' ? g.team.filter((id) => id in g.cards) : [],
    ready: room.phase === 'reveal' ? seat(room).filter((id) => g.ready[id]) : [],
    history: g.history, lastVote: g.lastVote, lastQuest: g.lastQuest,
    roleSet: [...new Set(Object.values(g.roles))].sort(),
    winner: g.winner, reason: g.reason, target: g.target,
  };
}

export function viewForPlayer(room, playerId, connected = new Set()) {
  const me = byId(room, playerId);
  const g = room.game;
  const view = {
    kind: 'player', code: room.code, phase: room.phase, settings: room.settings,
    players: room.players.map((p) => ({ id: p.id, name: p.name, host: !!p.host, online: connected.has(p.id) })),
    me: me ? { id: me.id, name: me.name, host: !!me.host } : null,
    game: publicGame(room),
  };
  if (g && me) {
    view.me.role = roleView(g.roles[me.id]);
    view.me.sees = knowledgeFor(me.id, g.roles);
    if (room.phase === 'vote' && me.id in g.votes) view.me.vote = g.votes[me.id];
    if (room.phase === 'quest' && me.id in g.cards) view.me.played = true;
  }
  if (g && room.phase === 'assassin') {
    // The Shadow steps forward for the last strike (everyone sees who they are, not their exact roles,
    // except the Assassin, who must be known so the table knows who is choosing).
    view.game.shadow = seat(room).filter((id) => ROLES[g.roles[id]].side === 'shadow');
    view.game.assassin = seat(room).find((id) => g.roles[id] === 'assassin');
  }
  if (g && room.phase === 'over') view.game.roles = Object.fromEntries(seat(room).map((id) => [id, roleView(g.roles[id])]));
  return view;
}
