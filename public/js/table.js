// The table layer, shared by Quest Night and Council Night (identical copy in each repo).
// Everything a table needs that is not the game itself: seats, play modes, house rules, chat and claims,
// the game log, Table Tools (coin, dice, picker, timers, talk turns, tally, counters) and host controls
// (pause, nudge, replace, hand off, mute, undo). Pure and deterministic given `rng` and `now`.

export const MAX_NAME = 20;
export const MAX_CHAT = 280;
export const MAX_LOG = 300;
export const PIECES = ['roles', 'votes', 'cards'];
export const MODE_PRESETS = {
  phone: { play: 'phone', roles: 'app', votes: 'app', cards: 'app' },
  physical: { play: 'physical', roles: 'physical', votes: 'physical', cards: 'physical' },
};
export const COMMON_HOUSE = { turnTimer: 0, revealDelay: 0, anonVotes: false, noClaims: false, sitOut: false, firstLeader: 'random' };
const TIMER_CHOICES = [0, 30, 60, 90, 120, 180, 300];

const ok = (data = {}) => ({ ok: true, data });
const err = (error) => ({ error });
export const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
const cleanText = (s, n = MAX_CHAT) => String(s ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, n);
const randToken = (rng) => Array.from({ length: 24 }, () => Math.floor(rng() * 16).toString(16)).join('');
const int = (x, lo, hi, d) => { const n = Math.round(Number(x)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

export function newTable(code, hostKey, settings, house) {
  return { code, hostKey, created: Date.now(), updated: Date.now(), phase: 'lobby', players: [], nextId: 1,
    settings: { ...settings }, house: { ...COMMON_HOUSE, ...house }, mode: { ...MODE_PRESETS.phone },
    game: null, log: [], logN: 0, paused: null, timer: null, talk: null, poll: null, counters: [], nudges: {}, undo: [] };
}

export const HYBRID_DEFAULT = { play: 'hybrid', roles: 'physical', votes: 'app', cards: 'app' };
export function cleanMode(m = {}, prev = MODE_PRESETS.phone) {
  const play = ['phone', 'hybrid', 'physical'].includes(m.play) ? m.play : prev.play;
  if (play !== 'hybrid') return { ...MODE_PRESETS[play] };
  const base = prev.play === 'hybrid' ? prev : HYBRID_DEFAULT;
  const out = { play: 'hybrid' };
  for (const k of PIECES) out[k] = m[k] === 'physical' || m[k] === 'app' ? m[k] : base[k];
  return out;
}

export function cleanHouse(h, prev, defaults) {
  const out = { ...prev };
  for (const [k, d] of Object.entries(defaults)) {
    if (!(k in h)) continue;
    const v = h[k];
    if (k === 'turnTimer') out[k] = TIMER_CHOICES.includes(+v) ? +v : prev[k];
    else if (k === 'revealDelay') out[k] = [0, 3, 5].includes(+v) ? +v : prev[k];
    else if (k === 'firstLeader') out[k] = v === 'host' ? 'host' : 'random';
    else if (typeof d === 'boolean') out[k] = !!v;
  }
  return out;
}

export const byId = (room, id) => room.players.find((p) => p.id === id);
export const seated = (room) => room.players.filter((p) => !p.watch);
export const seatIds = (room) => seated(room).map((p) => p.id);

export function log(room, kind, text, by = null, now = Date.now(), extra = {}) {
  room.logN = (room.logN || 0) + 1;
  room.log.push({ n: room.logN, t: now, kind, by, text: String(text), ...extra });
  if (room.log.length > MAX_LOG) room.log.splice(0, room.log.length - MAX_LOG);
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
export function startTimer(room, secs, label, now, auto = false) {
  room.timer = { label: cleanText(label, 40) || 'Timer', secs, endsAt: room.paused ? null : now + secs * 1000, left: room.paused ? secs * 1000 : null, auto };
}

// Called by the game after any action that changes the phase.
export function onPhaseChange(room, now) {
  if (room.timer?.auto) room.timer = null;
  room.talk = null;
  const t = room.house.turnTimer;
  if (t > 0 && room.game && room.phase !== 'over' && room.phase !== 'lobby') startTimer(room, t, 'Phase timer', now, true);
}

// Requirements for starting with the chosen mode. Returns an error string or null.
export function modeProblem(room) {
  const m = room.mode;
  const noPhone = seated(room).filter((p) => p.phoneless);
  const need = PIECES.filter((k) => m[k] === 'app');
  if (noPhone.length && need.length) return `${noPhone.map((p) => p.name).join(', ')} ${noPhone.length > 1 ? 'have' : 'has'} no phone. Set ${need.join(', ')} to “physical”, or remove the seat.`;
  return null;
}

// Returns a result when the message is a table action, or null so the game reducer handles it.
// hooks: { minPlayers, maxPlayers, houseDefaults, gameName, canChat(room, me) }
export function reduceTable(room, actor, msg, rng, now, hooks) {
  const me = actor.playerId ? byId(room, actor.playerId) : null;
  const isHost = !!me?.host;
  const name = me?.name;
  const T = msg.type;
  const hostOnly = () => (isHost ? null : err('Only the host can do that.'));
  const lobbyOnly = () => (room.phase === 'lobby' ? null : err('That can only be changed in the lobby.'));

  switch (T) {
    case 'join': {
      const nm = cleanName(msg.name);
      if (!nm) return err('Type your name first.');
      const open = room.phase !== 'lobby' ? room.players.find((p) => p.open && p.name.toLowerCase() === nm.toLowerCase()) || room.players.find((p) => p.open) : null;
      if (room.players.some((p) => p !== open && p.name.toLowerCase() === nm.toLowerCase())) return err('Someone at the table already has that name.');
      if (open) { // takes over a seat the host opened
        const old = open.name; open.name = nm; open.token = randToken(rng); open.open = false; open.phoneless = false;
        log(room, 'host', `${nm} took over ${old}’s seat.`, null, now);
        return ok({ playerId: open.id, token: open.token });
      }
      const watch = room.phase !== 'lobby';
      if (!watch && seated(room).length >= hooks.maxPlayers) return err(`The table is full (${hooks.maxPlayers} players).`);
      const host = !!msg.hostKey && msg.hostKey === room.hostKey && !room.players.some((p) => p.host);
      const p = { id: `p${room.nextId++}`, name: nm, token: randToken(rng), host, watch: watch || (host && room.house.sitOut) };
      room.players.push(p);
      if (watch) log(room, 'sys', `${nm} is watching.`, null, now);
      return ok({ playerId: p.id, token: p.token });
    }
    case 'addSeat': { // a seat for someone without a phone (physical play)
      const e = hostOnly() || lobbyOnly(); if (e) return e;
      const nm = cleanName(msg.name);
      if (!nm) return err('Type a name for the seat.');
      if (room.players.some((p) => p.name.toLowerCase() === nm.toLowerCase())) return err('Someone at the table already has that name.');
      if (seated(room).length >= hooks.maxPlayers) return err(`The table is full (${hooks.maxPlayers} players).`);
      room.players.push({ id: `p${room.nextId++}`, name: nm, token: null, host: false, phoneless: true });
      return ok();
    }
    case 'kick': {
      const e = hostOnly(); if (e) return e;
      const p = byId(room, msg.id);
      if (!p || p.host) return err('That player can’t be removed.');
      if (room.phase === 'lobby' || p.watch) { room.players = room.players.filter((x) => x.id !== p.id); return ok(); }
      // Mid-game: open the seat so someone else can take it over (same secret card, new phone).
      p.open = true; p.token = randToken(rng);
      log(room, 'host', `The host opened ${p.name}’s seat. The next person to join takes it over.`, null, now);
      return ok();
    }
    case 'move': {
      const e = hostOnly() || lobbyOnly(); if (e) return e;
      const i = room.players.findIndex((p) => p.id === msg.id);
      const j = i + (msg.dir === 'up' ? -1 : 1);
      if (i < 0 || j < 0 || j >= room.players.length) return err('Can’t move that seat.');
      [room.players[i], room.players[j]] = [room.players[j], room.players[i]];
      return ok();
    }
    case 'shuffleSeats': {
      const e = hostOnly() || lobbyOnly(); if (e) return e;
      const a = [...room.players];
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      room.players = a;
      log(room, 'tool', `Seats shuffled: ${seated(room).map((p) => p.name).join(', ')}.`, name, now);
      return ok();
    }
    case 'mode': {
      const e = hostOnly() || lobbyOnly(); if (e) return e;
      room.mode = cleanMode(msg.mode || {}, room.mode);
      return ok();
    }
    case 'house': {
      const e = hostOnly() || lobbyOnly(); if (e) return e;
      room.house = cleanHouse(msg.house || {}, room.house, { ...COMMON_HOUSE, ...hooks.houseDefaults });
      const host = room.players.find((p) => p.host);
      if (host) host.watch = !!room.house.sitOut;
      return ok();
    }
    case 'handoff': {
      const e = hostOnly(); if (e) return e;
      const p = byId(room, msg.id);
      if (!p || p === me || p.phoneless || p.open) return err('Choose someone at the table with a phone.');
      me.host = false; p.host = true;
      if (room.phase === 'lobby' && room.house.sitOut) { me.watch = false; p.watch = true; }
      log(room, 'host', `${me.name} handed hosting to ${p.name}.`, null, now);
      return ok();
    }
    case 'claimHost': { // the host's phone died: anyone can take over with the host key from the link
      if (!me || msg.hostKey !== room.hostKey) return err('That host key does not match.');
      for (const p of room.players) p.host = false;
      me.host = true;
      log(room, 'host', `${me.name} is now hosting.`, null, now);
      return ok();
    }
    case 'pause': case 'resume': {
      const e = hostOnly(); if (e) return e;
      if (!room.game || room.phase === 'over') return err('No game is running.');
      if (T === 'pause') {
        if (room.paused) return ok();
        room.paused = { at: now };
        if (room.timer?.endsAt) { room.timer.left = Math.max(0, room.timer.endsAt - now); room.timer.endsAt = null; }
        if (room.talk?.endsAt) { room.talk.left = Math.max(0, room.talk.endsAt - now); room.talk.endsAt = null; }
        log(room, 'host', 'The host paused the game.', null, now);
      } else {
        if (!room.paused) return ok();
        room.paused = null;
        if (room.timer && room.timer.left != null) { room.timer.endsAt = now + room.timer.left; room.timer.left = null; }
        if (room.talk && room.talk.left != null) { room.talk.endsAt = now + room.talk.left; room.talk.left = null; }
        log(room, 'host', 'The game is back on.', null, now);
      }
      return ok();
    }
    case 'nudge': {
      const e = hostOnly(); if (e) return e;
      const p = byId(room, msg.id);
      if (!p || p.phoneless) return err('That seat has no phone to nudge.');
      room.nudges[p.id] = (room.nudges[p.id] || 0) + 1;
      log(room, 'host', `The host nudged ${p.name}.`, null, now);
      return ok();
    }
    case 'mute': {
      const e = hostOnly(); if (e) return e;
      const p = byId(room, msg.id);
      if (!p || p.host) return err('Can’t mute that player.');
      p.muted = !p.muted;
      log(room, 'host', `${p.name} was ${p.muted ? 'muted' : 'unmuted'} in the chat.`, null, now);
      return ok();
    }
    case 'hideMsg': {
      const e = hostOnly(); if (e) return e;
      const m = room.log.find((x) => x.n === msg.n && (x.kind === 'chat' || x.kind === 'claim'));
      if (!m) return err('No such message.');
      m.hidden = true;
      return ok();
    }
    case 'chat': case 'claim': {
      if (!me) return err('Join the table first.');
      if (me.muted) return err('The host muted you in the chat.');
      if (T === 'claim' && room.house.noClaims) return err('No-claims mode is on: say it out loud instead.');
      const text = cleanText(msg.text);
      if (!text) return err('Type a message first.');
      log(room, T, text, me.name, now, { pid: me.id });
      return ok();
    }

    // ---------------- Table Tools (results everyone sees, from the server's random source)
    case 'coin': {
      if (!me) return err('Join the table first.');
      log(room, 'tool', `${name} flipped a coin: ${rng() < 0.5 ? 'Heads' : 'Tails'}.`, name, now);
      return ok();
    }
    case 'dice': {
      if (!me) return err('Join the table first.');
      const count = int(msg.count, 1, 6, 1); const sides = [4, 6, 8, 10, 12, 20].includes(+msg.sides) ? +msg.sides : 6;
      const r = Array.from({ length: count }, () => 1 + Math.floor(rng() * sides));
      log(room, 'tool', `${name} rolled ${count}d${sides}: ${r.join(', ')}${count > 1 ? ` (total ${r.reduce((a, b) => a + b, 0)})` : ''}.`, name, now);
      return ok();
    }
    case 'pickPlayer': {
      if (!me) return err('Join the table first.');
      const pool = (hooks.alive ? hooks.alive(room) : seatIds(room)).map((id) => byId(room, id)).filter(Boolean);
      if (!pool.length) return err('Nobody to pick.');
      const p = pool[Math.floor(rng() * pool.length)];
      log(room, 'tool', `${name} picked a random player${msg.why ? ` (${cleanText(msg.why, 40)})` : ''}: ${p.name}.`, name, now);
      return ok();
    }
    case 'timer': {
      const e = hostOnly(); if (e) return e;
      const secs = int(msg.secs, 5, 3600, 60);
      startTimer(room, secs, msg.label || 'Discussion', now);
      log(room, 'tool', `The host started a ${mmss(secs)} timer${msg.label ? ` (${cleanText(msg.label, 40)})` : ''}.`, null, now);
      return ok();
    }
    case 'timerStop': { const e = hostOnly(); if (e) return e; room.timer = null; return ok(); }
    case 'talk': { // a talk-turn timer that passes around the table
      const e = hostOnly(); if (e) return e;
      const secs = int(msg.secs, 10, 600, 45);
      const order = hooks.alive ? hooks.alive(room) : seatIds(room);
      if (!order.length) return err('Nobody to talk.');
      let start = order.indexOf(msg.from); if (start < 0) start = 0;
      room.talk = { order: [...order.slice(start), ...order.slice(0, start)], i: 0, secs, endsAt: room.paused ? null : now + secs * 1000, left: room.paused ? secs * 1000 : null };
      log(room, 'tool', `Talk turns started: ${mmss(secs)} each, ${byId(room, room.talk.order[0]).name} first.`, null, now);
      return ok();
    }
    case 'talkNext': {
      if (!room.talk) return err('No talk turns running.');
      if (!isHost && me?.id !== room.talk.order[room.talk.i]) return err('Only the speaker or the host can pass the turn.');
      room.talk.i += 1;
      if (room.talk.i >= room.talk.order.length) { room.talk = null; log(room, 'tool', 'Talk turns finished.', null, now); return ok(); }
      room.talk.endsAt = room.paused ? null : now + room.talk.secs * 1000; room.talk.left = room.paused ? room.talk.secs * 1000 : null;
      return ok();
    }
    case 'talkStop': { const e = hostOnly(); if (e) return e; room.talk = null; return ok(); }
    case 'poll': { // a show-of-hands tally: players tap on phones, the host can add hands for phoneless seats
      const e = hostOnly(); if (e) return e;
      const q = cleanText(msg.q, 80) || 'Show of hands';
      let options = Array.isArray(msg.options) ? msg.options.map((o) => cleanText(o, 30)).filter(Boolean).slice(0, 10) : [];
      if (msg.players) options = (hooks.alive ? hooks.alive(room) : seatIds(room)).map((id) => byId(room, id).name);
      if (options.length < 2) options = ['Yes', 'No'];
      room.poll = { q, options, votes: {}, extra: options.map(() => 0), open: true };
      log(room, 'tool', `The host opened a tally: ${q} (${options.join(' / ')}).`, null, now);
      return ok();
    }
    case 'pollVote': {
      if (!me || !room.poll?.open) return err('No tally is open.');
      const i = int(msg.i, 0, room.poll.options.length - 1, -1);
      if (i < 0) return err('Pick an option.');
      room.poll.votes[me.id] = i; return ok();
    }
    case 'pollAdd': {
      const e = hostOnly(); if (e) return e;
      if (!room.poll?.open) return err('No tally is open.');
      const i = int(msg.i, 0, room.poll.options.length - 1, 0);
      room.poll.extra[i] = Math.max(0, room.poll.extra[i] + (msg.d < 0 ? -1 : 1)); return ok();
    }
    case 'pollClose': {
      const e = hostOnly(); if (e) return e;
      if (!room.poll) return err('No tally is open.');
      const counts = pollCounts(room.poll);
      const top = Math.max(...counts);
      const lead = counts.map((c, i) => (c === top ? i : -1)).filter((i) => i >= 0);
      let res = `${room.poll.q}: ${room.poll.options.map((o, i) => `${o} ${counts[i]}`).join(', ')}.`;
      if (lead.length > 1 && msg.tiebreak) res += ` Tie broken at random: ${room.poll.options[lead[Math.floor(rng() * lead.length)]]}.`;
      else if (lead.length > 1) res += ' A tie.';
      else res += ` Most hands: ${room.poll.options[lead[0]]}.`;
      log(room, 'tool', res, null, now);
      room.poll = null; return ok();
    }
    case 'counter': { // score or round trackers
      const e = hostOnly(); if (e) return e;
      if (msg.op === 'add') { if (room.counters.length >= 6) return err('Up to 6 counters.'); room.counters.push({ id: `c${room.logN + room.counters.length + 1}${Math.floor(rng() * 1e6)}`, label: cleanText(msg.label, 24) || 'Round', value: 0 }); return ok(); }
      const c = room.counters.find((x) => x.id === msg.id);
      if (!c) return err('No such counter.');
      if (msg.op === 'del') room.counters = room.counters.filter((x) => x !== c);
      else c.value = int(c.value + (msg.op === 'dec' ? -1 : 1), -999, 999, 0);
      return ok();
    }
    case 'undo': {
      const e = hostOnly(); if (e) return e;
      // The end screen shows every role, so a finished game stays finished (Restart / Play again start a new one).
      if (room.phase === 'over') return err('The game is over. Use Restart or Play again.');
      const snap = room.undo.pop();
      if (!snap) return err('Nothing to undo.');
      const s = JSON.parse(snap); room.game = s.game; room.phase = s.phase;
      log(room, 'host', 'The host undid the last step.', null, now);
      return ok();
    }
    default: return null;
  }
}

export const pollCounts = (poll) => poll.options.map((_, i) => Object.values(poll.votes).filter((v) => v === i).length + (poll.extra[i] || 0));

// Public table state for one viewer (no secrets live here; the game adds its own projection).
export function tableView(room, viewerId, connected) {
  const me = viewerId ? byId(room, viewerId) : null;
  return {
    code: room.code, gameNo: room.gameNo || 1, phase: room.phase, settings: room.settings, house: room.house, mode: room.mode,
    players: room.players.map((p) => ({ id: p.id, name: p.name, host: !!p.host, watch: !!p.watch, phoneless: !!p.phoneless, open: !!p.open, muted: !!p.muted, online: connected.has(p.id) })),
    log: room.log.slice(-150).map((m) => (m.hidden ? { n: m.n, t: m.t, kind: m.kind, by: m.by, text: '(removed by the host)', hidden: true } : { n: m.n, t: m.t, kind: m.kind, by: m.by, text: m.text })),
    paused: !!room.paused, timer: room.timer, talk: room.talk,
    poll: room.poll ? { q: room.poll.q, options: room.poll.options, counts: pollCounts(room.poll), mine: me && me.id in room.poll.votes ? room.poll.votes[me.id] : null } : null,
    counters: room.counters, canUndo: room.phase !== 'over' && room.undo.length > 0,
    me: me ? { id: me.id, name: me.name, host: !!me.host, watch: !!me.watch, muted: !!me.muted, nudged: room.nudges[me.id] || 0 } : null,
  };
}
