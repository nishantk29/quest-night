// Seeded random games played through the event log (public/js/event-log.js), for the undo, redo and replay tests.
// Every move is an event with seed words drawn from the game's own stream, so a game is the same on every run.
// Moves: random legal-ish messages from random seats (tools and chat included), with the host's fallbacks when
// nothing else is accepted, in phone, physical and mixed play, 5 to 10 players, and the Lantern on some tables.
import { GameLog } from '../../public/js/event-log.js';
import { newRoom } from '../../public/js/room.js';

export function stream(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  const u32 = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
  const r = () => u32() / 0x100000000;
  return { u32, r, pick: (a) => a[Math.floor(r() * a.length)], chance: (p) => r() < p, seed4: () => [u32(), u32(), u32(), u32()] };
}

export const MODES = {
  phone: null,
  physical: { play: 'physical' },
  mixed: { play: 'hybrid', roles: 'app', votes: 'physical', cards: 'app' },
};

// A table in the lobby, through the log: n seats, a mode, maybe the Lantern. Returns { log, ids, S, t(), act() }.
export function newGame(seed, { Log = GameLog } = {}) {
  const S = stream(seed); let clock = 1_000_000;
  const log = new Log(newRoom('LOGGME', 'hk'));
  const t = () => (clock += 1 + Math.floor(S.r() * 4000));
  const act = (id, msg) => log.apply(id ? { playerId: id } : { anon: true }, msg, t(), S.seed4());
  const n = 5 + Math.floor(S.r() * 6); const ids = [];
  for (let i = 0; i < n; i++) ids.push(act(null, { type: 'join', name: `P${i}`, hostKey: i ? undefined : 'hk' }).data.playerId);
  const mode = S.pick(Object.keys(MODES));
  if (MODES[mode]) act(ids[0], { type: 'mode', mode: MODES[mode] });
  if (S.chance(0.4)) act(ids[0], { type: 'house', house: { lantern: true } });
  if (S.chance(0.5)) act(ids[0], { type: 'settings', settings: { merlin: true, percival: S.chance(0.5), morgana: S.chance(0.5) } });
  return { log, ids, S, t, act, mode, tag: `seed=${seed} ${n}p ${mode}` };
}

const leaderOf = (room) => { const g = room.game; const seats = room.players.filter((p) => !p.watch).map((p) => p.id); return seats[g.leader % g.n]; };

// One move: a random message from a random seat, or the host's fallback. Returns the result (kept or not).
export function move(G) {
  const { log, ids, S, act } = G; const room = log.room; const g = room.game; const H = ids[0];
  const any = () => S.pick(ids);
  if (room.phase === 'lobby') return act(H, { type: 'start' });
  if (S.chance(0.05)) return act(any(), S.pick([{ type: 'chat', text: `hi ${S.u32() % 100}` }, { type: 'coin' }, { type: 'dice', count: 2, sides: 6 }, { type: 'pickPlayer' }]));
  if (S.chance(0.02)) return act(H, { type: 'timer', secs: 60 });
  const size = g.sizes[g.quest];
  const team = () => [...ids].sort(() => S.r() - 0.5).slice(0, size);
  const cands = [
    [any(), { type: 'ready' }], [leaderOf(room), { type: 'propose', team: team() }], [H, { type: 'propose', team: team() }],
    [any(), { type: 'vote', approve: S.chance(0.6) }], [H, { type: 'tally', approve: ids.filter(() => S.chance(0.6)) }],
    [S.pick(g.team.length ? g.team : ids), { type: 'play', sabotage: S.chance(0.4) }], [H, { type: 'questResult', fails: Math.floor(S.r() * 2) }],
    [g.lantern?.holder || H, { type: 'examine', id: any() }], [H, { type: 'examine', id: any() }],
    [any(), { type: 'strike', id: any() }], [H, { type: 'strikeResult', id: any(), hit: S.chance(0.3) }],
  ];
  for (let k = 0; k < 12; k++) { const [who, msg] = S.pick(cands); const r = act(who, msg); if (r.kept) return r; }
  return fallback(G);
}
export function fallback(G) {
  const { log, ids, act } = G; const room = log.room; const g = room.game; const H = ids[0];
  const fb = [{ type: 'skipReveal' }, { type: 'skip', id: leaderOf(room) }, ...ids.map((id) => ({ type: 'skip', id })), { type: 'skip' },
    { type: 'tally', approve: ids }, { type: 'questResult', fails: 0 }, { type: 'strikeResult', id: ids[1], hit: false }];
  void g;
  for (const m of fb) { const r = act(H, m); if (r.kept) return r; }
  return { error: `stuck in ${room.phase}`, kept: false, stuck: true };
}

// Plays a game to the end (or `max` moves). onMove(G, r) after each kept move.
export function play(G, { max = 400, onMove = () => {} } = {}) {
  for (let i = 0; i < max && G.log.room.phase !== 'over'; i++) {
    const r = move(G); if (r.stuck) throw new Error(`${G.tag}: ${r.error}`);
    onMove(G, r);
  }
  return G;
}
