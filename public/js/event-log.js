// The game as an event log: every change to a room is one event, and the room = replay(base, events).
// Pure (no storage, no sockets): the Durable Object persists it (src/worker.js), tests drive it directly.
// An event: { a: actor, m: message, e: [4 seed words], t: time, s?: 1 a step, q?: 1 a quest result }.
// Replaying an event gives back exactly the same room, because the reducer's rng and clock come from the event.
// Shared shape with Mafia Night's event-log.js; the steps and labels below are this game's.
import { reduce } from './room.js';
import { seededRng, newSeed } from './entropy.js';
import { UNDO_PAST_GAME_OVER, UNDO_PAST_RESULT } from './config-defaults.js';

export const SNAP_EVERY = 64; // a checkpoint (whole room) every 64 events, so a replay never runs more than 64
export const LOG_VERSION = 1;

const clone = (x) => structuredClone(x);
const isHostActor = (room, a) => !!a?.playerId && !!room.players.find((p) => p.id === a.playerId)?.host;

// Applies one event to a room, in place, the same way live and in replay. Returns the reducer's result.
const actorOf = (a) => (a.anon ? { anon: true } : { playerId: a.playerId });
export function applyEvent(room, ev) {
  const res = reduce(room, actorOf(ev.a), ev.m, seededRng(ev.e), ev.t);
  room.updated = ev.t;
  return res;
}

// A step is what Undo and Redo move over: a decision that moves the game on. A single vote or quest card is not a
// step; it goes back together with the step it belongs to (the proposal), unless it was the one that closed the
// vote or the quest, which changes the phase and so is a step of its own.
export const STEP_TYPES = new Set(['start', 'restart', 'skipReveal', 'propose', 'tally', 'questResult', 'examine', 'strike', 'strikeResult', 'skip', 'again', 'abandon']);
// Events that change who sits where or who hosts. Going back over one would take a phone's seat or the host's
// role away, so Undo stops there (Redo and every host fallback still work, so nothing locks).
export const SEAT_TYPES = new Set(['join', 'kick', 'handoff', 'claimHost', 'addSeat']);

// Runs a message against a live room as an event and reports whether the room changed. The caller keeps the
// event only when it did: a refused message, or one that changed nothing, is not a step of undo.
export function commit(room, actor, msg, now = Date.now(), seed = newSeed()) {
  const before = JSON.stringify(room);
  const phase = room.phase; const quests = room.game?.results.length ?? 0;
  const ev = { a: { ...(actor.anon ? { anon: true } : { playerId: actor.playerId }), host: isHostActor(room, actor) }, m: msg, e: seed, t: now };
  const res = reduce(room, actorOf(ev.a), ev.m, seededRng(ev.e), ev.t);
  const changed = JSON.stringify(room) !== before;
  if (changed) room.updated = ev.t;
  if (STEP_TYPES.has(msg.type) || room.phase !== phase) ev.s = 1;
  if (msg.type === 'skip') ev.p = phase; // a skip means something else in each phase (its label)
  if ((room.game?.results.length ?? 0) > quests) ev.q = 1;
  return { res, ev, changed };
}

// Replays events [from, to) on a copy of `start`.
export function replay(start, events, from = 0, to = events.length) {
  const room = clone(start);
  for (let i = from; i < to; i++) applyEvent(room, events[i]);
  return room;
}

// The whole log in memory (tests, and the shape the DO stores in chunks).
// cursor = how many events are in effect; events past it are the redo branch. rev bumps on every change.
export class GameLog {
  constructor(base, { snapEvery = SNAP_EVERY } = {}) {
    this.base = clone(base);
    this.events = [];
    this.cursor = 0;
    this.rev = 0;
    this.snapEvery = snapEvery;
    this.snaps = new Map(); // index (multiple of snapEvery) -> room after that many events
    this.room = clone(base);
  }
  static restore({ base, events, cursor, rev, snaps }, opts) {
    const g = new GameLog(base, opts);
    g.events = events.slice(); g.cursor = cursor; g.rev = rev;
    for (const [i, s] of snaps || []) g.snaps.set(Number(i), clone(s));
    g.room = g.stateAt(cursor);
    return g;
  }

  // The room after the first i events, from the nearest checkpoint at or before i.
  stateAt(i) {
    let k = Math.floor(i / this.snapEvery) * this.snapEvery;
    while (k > 0 && !this.snaps.has(k)) k -= this.snapEvery;
    return replay(k ? this.snaps.get(k) : this.base, this.events, k, i);
  }

  // A new message: applies it, and keeps it (dropping the redo branch) if it changed the room.
  apply(actor, msg, now = Date.now(), seed = undefined) {
    const r = commit(this.room, actor, msg, now, seed);
    if (!r.changed) return { ...r.res, kept: false };
    if (this.cursor < this.events.length) {
      this.events.length = this.cursor;
      for (const k of this.snaps.keys()) if (k > this.cursor) this.snaps.delete(k);
    }
    this.events.push(r.ev);
    this.cursor++;
    this.rev++;
    if (this.cursor % this.snapEvery === 0) this.snaps.set(this.cursor, clone(this.room));
    return { ...r.res, kept: true, ev: r.ev };
  }
  moveTo(i) {
    if (!Number.isInteger(i) || i < 0 || i > this.events.length) return false;
    if (i === this.cursor) return true;
    this.room = this.stateAt(i);
    this.cursor = i; this.rev++;
    return true;
  }
  // One step back or forward. Returns the step's label, or null.
  undoStep(opts) { const u = undoTarget(this.events, this.cursor, this.room, opts); if (u.i === null) return null; const label = stepLabel(this.events[u.i], this.room); this.moveTo(u.i); return label; }
  redoStep() { const f = firstStep(this.events, this.cursor); if (f < 0) return null; const label = stepLabel(this.events[f], this.room); this.moveTo(redoTarget(this.events, this.cursor)); return label; }
  history(opts) { return historyInfo(this.events, this.cursor, this.room, opts); }
  toJSON() { return { v: LOG_VERSION, base: this.base, events: this.events, cursor: this.cursor, rev: this.rev, snaps: [...this.snaps] }; }
}

// ---------- chunked storage layout (the DO's keys; one value per chunk keeps each well under the 2 MB limit) ----------
// elog:meta  { v, rev, cursor, len, snapEvery }   elog:base  the starting room
// elog:c:<k> events [k*snapEvery, (k+1)*snapEvery)   elog:s:<k> the room after k*snapEvery events (k >= 1)
export const KEY = { meta: 'elog:meta', base: 'elog:base', chunk: (k) => `elog:c:${k}`, snap: (k) => `elog:s:${k}` };
export const chunkOf = (i, snapEvery = SNAP_EVERY) => Math.floor(i / snapEvery);

// ---------- steps: what Undo and Redo move over ----------
// Undo goes back to just before the last step; whatever happened after it (votes, cards, chat, tools) goes with it.
// Redo goes forward over the next step and everything up to the step after it.
// Undo is off in the lobby (it would drop players who joined), on the end screen unless UNDO_PAST_GAME_OVER, over a
// shown quest result unless UNDO_PAST_RESULT, and over a seat change (see SEAT_TYPES).
const isStep = (ev) => !!ev?.s;
function firstStep(events, from) { for (let i = from; i < events.length; i++) if (isStep(events[i])) return i; return -1; }
export function undoTarget(events, cursor, room, { pastOver = UNDO_PAST_GAME_OVER, pastResult = UNDO_PAST_RESULT } = {}) {
  if (!room || room.phase === 'lobby') return { i: null, why: 'Nothing to undo.' };
  if (room.phase === 'over' && !pastOver) return { i: null, why: 'The game is over. Use Restart or Play again.' };
  let i = cursor - 1; while (i >= 0 && !isStep(events[i])) i--;
  if (i < 0) return { i: null, why: 'Nothing to undo.' };
  for (let j = i; j < cursor; j++) {
    if (SEAT_TYPES.has(events[j].m?.type)) return { i: null, why: 'Someone joined or changed seats since then, so Undo stops here.' };
    if (events[j].q && !pastResult) return { i: null, why: 'Everyone has seen that quest result.' };
  }
  return { i, why: '' };
}
export function redoTarget(events, cursor) {
  const f = firstStep(events, cursor); if (f < 0) return null;
  const g = firstStep(events, f + 1);
  return g < 0 ? events.length : g;
}
const VERB = {
  start: () => 'The deal', restart: () => 'Restart', skipReveal: () => 'Skipping the reveal', ready: () => 'The reveal',
  propose: () => 'The party proposal', vote: () => 'The vote', tally: () => 'The vote count', play: () => 'The quest', questResult: () => 'The quest result',
  examine: () => 'The Lantern', strike: () => 'The Assassin’s strike', strikeResult: () => 'The Assassin’s strike',
  again: () => 'Play again', abandon: () => 'Ending the game',
};
const SKIP = { reveal: (n) => `${n}’s reveal`, propose: () => 'Passing the crown', vote: (n) => `Skipping ${n}’s vote`, quest: (n) => `Playing ${n}’s card`, lantern: () => 'Skipping the Lantern', assassin: () => 'Skipping the Assassin' };
export function stepLabel(ev, room) {
  if (!ev) return '';
  const name = room?.players?.find((p) => p.id === ev.m?.id)?.name || 'a player';
  if (ev.m?.type === 'skip') return (SKIP[ev.p] || (() => 'A skip'))(name);
  return (VERB[ev.m?.type] || (() => 'The last change'))(name);
}
export function historyInfo(events, cursor, room, opts) {
  const u = undoTarget(events, cursor, room, opts); const f = firstStep(events, cursor);
  return {
    canUndo: u.i !== null, undoLabel: u.i !== null ? stepLabel(events[u.i], room) : '', undoWhy: u.why,
    canRedo: f >= 0, redoLabel: f >= 0 ? stepLabel(events[f], room) : '',
  };
}
