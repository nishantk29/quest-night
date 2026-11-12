// Undo and Redo on the event log (public/js/event-log.js), matching Mafia Night: unlimited back and forward on
// every phone, rev-checked, the seed in each event, back over a seen quest result and from the end screen.
// Pure part: seeded random games through the log. Room part: the real Durable Object with fake storage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { GameLog, KEY, replay, applyEvent, SNAP_EVERY } from '../public/js/event-log.js';
import { newRoom, viewForPlayer, viewForScreen } from '../public/js/room.js';
import { UNDO_PAST_RESULT, UNDO_PAST_GAME_OVER, NOTIFY_ON_UNDO } from '../public/js/config-defaults.js';
import { newGame, play, move, fallback, stream } from './kit/log-games.mjs';

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(s, c, n) { return s === 'cloudflare:workers' ? { url: 'data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}', shortCircuit: true } : n(s, c); }`), import.meta.url);
const { Room } = await import('../src/worker.js');

const GAMES = Number(process.env.UNDO_GAMES || 60);
const SEED = Number(process.env.UNDO_SEED || 1);
const json = (x) => JSON.stringify(x);
const games = (f) => { for (let g = 0; g < GAMES; g++) f(SEED * 1000 + g); };

test('the chosen defaults: back over a seen quest result, back from the end screen, players told', () => {
  assert.equal(UNDO_PAST_RESULT, true); assert.equal(UNDO_PAST_GAME_OVER, true); assert.equal(NOTIFY_ON_UNDO, true);
});

// ---------- pure: properties over random games ----------
test(`P1: a cold replay of the log gives the live room after every event, and stateAt(i) is the room after i events (${GAMES} games)`, () => {
  let checked = 0;
  games((seed) => {
    const seen = [];
    const G = newGame(seed); seen[G.log.cursor] = json(G.log.room);
    play(G, { onMove: (H) => { seen[H.log.cursor] = json(H.log.room); } });
    const { log } = G;
    assert.equal(json(replay(log.base, log.events)), json(log.room), `${G.tag}: replay differs from live`);
    for (let i = 0; i <= log.events.length; i += 1 + (i % 7)) { if (seen[i]) { assert.equal(json(log.stateAt(i)), seen[i], `${G.tag}: stateAt(${i})`); checked++; } }
  });
  assert.ok(checked > GAMES * 10);
});

test(`P2: undo step by step lands just before each step, back to the lobby; redo step by step gives the end back (${GAMES} games)`, () => {
  let steps = 0;
  games((seed) => {
    const seen = []; const G = newGame(seed); seen[G.log.cursor] = json(G.log.room);
    play(G, { onMove: (H) => { seen[H.log.cursor] = json(H.log.room); } });
    const { log } = G; const end = json(log.room); const len = log.events.length; const visited = [];
    for (;;) {
      const at = log.cursor; const label = log.undoStep();
      if (label === null) break;
      steps++;
      assert.ok(log.cursor < at); assert.ok(log.events[log.cursor].s, `${G.tag}: undo landed off a step`);
      assert.equal(json(log.room), seen[log.cursor], `${G.tag}: undo to ${log.cursor} is not the room as it was`);
      assert.ok(typeof label === 'string' && label.length);
      visited.push(log.cursor);
    }
    assert.equal(log.room.phase, 'lobby', `${G.tag}: undo all the way stops in the lobby`);
    for (const i of visited.reverse().slice(1)) { assert.ok(log.redoStep() !== null); assert.equal(log.cursor, i, `${G.tag}: redo does not retrace undo`); }
    while (log.redoStep() !== null);
    assert.equal(log.cursor, len); assert.equal(json(log.room), end, `${G.tag}: redo to the end is not the same room`);
  });
  assert.ok(steps > GAMES * 10, `only ${steps} undo steps`);
});

test(`P3: random undo, redo and new moves keep the log consistent and never lock (${GAMES} games)`, () => {
  let ops = 0;
  games((seed) => {
    const G = newGame(seed + 77); const S = stream(seed);
    for (let k = 0; k < 300; k++) {
      const { log } = G; const x = S.r();
      if (x < 0.15) log.undoStep(); else if (x < 0.25) log.redoStep();
      else if (log.room.phase === 'over') { if (S.chance(0.5)) G.act(G.ids[0], { type: 'again' }); else log.undoStep(); }
      else { const r = move(G); assert.ok(!r.stuck, `${G.tag}: stuck in ${log.room.phase}`); }
      ops++;
      if (k % 25 === 0) assert.equal(json(log.stateAt(log.cursor)), json(log.room), `${G.tag}: op ${k}: the room is not the log`);
      if (k % 10 === 0 && log.room.phase !== 'lobby' && log.room.phase !== 'over') assert.ok(fallbackExists(G), `${G.tag}: no way forward in ${log.room.phase}`);
    }
    assert.equal(json(replay(G.log.base, G.log.events.slice(0, G.log.cursor))), json(G.log.room));
  });
  assert.ok(ops >= GAMES * 300);
});
// A host move is always accepted (tested on a copy, so the game is not changed).
function fallbackExists(G) {
  const copy = { ...G, log: GameLog.restore(structuredClone(G.log.toJSON())), S: stream(1) };
  copy.act = (id, msg) => copy.log.apply(id ? { playerId: id } : { anon: true }, msg, G.t(), [1, 2, 3, 4]);
  return !fallback(copy).stuck;
}

test(`P4: every event replays from its own seed: other seed words give another deal, the same ones give the same room (${GAMES} games)`, () => {
  let differ = 0;
  games((seed) => {
    const G = play(newGame(seed)); const { log } = G;
    const i = log.events.findIndex((e) => e.m.type === 'start');
    const before = log.stateAt(i);
    const a = structuredClone(before), b = structuredClone(before), c = structuredClone(before);
    applyEvent(a, log.events[i]); applyEvent(b, log.events[i]); applyEvent(c, { ...log.events[i], e: log.events[i].e.map((w) => (w ^ 0x9e3779b9) >>> 0) });
    assert.equal(json(a), json(b), `${G.tag}: the same seed gave another deal`);
    if (json(a.game) !== json(c.game)) differ++;
  });
  assert.ok(differ > GAMES * 0.9, `only ${differ} of ${GAMES} deals changed with other seed words`);
});

test('P4 mutation: a log that ignores the seed (Math.random) fails the replay check', () => {
  const real = Math.random; let failed = 0;
  for (let s = 0; s < 10; s++) {
    const G = newGame(s); const ev = G.log.events;
    play(G);
    // replay with a reducer that draws its own randomness: patch every event's seed to fresh words
    const leaky = ev.map((e) => ({ ...e, e: [real() * 2 ** 32 >>> 0, 1, 2, 3] }));
    if (json(replay(G.log.base, leaky)) !== json(G.log.room)) failed++;
  }
  assert.equal(failed, 10);
});

// ---------- pure: the semantics ----------
function table5() {
  const G = newGame(4242); const { act, ids, log } = G;
  if (log.room.mode.play !== 'phone') act(ids[0], { type: 'mode', mode: { play: 'phone' } });
  act(ids[0], { type: 'start' }); act(ids[0], { type: 'skipReveal' });
  return G;
}
const leader = (room) => room.players.filter((p) => !p.watch)[room.game.leader % room.game.n].id;

test('a single vote is not a step: it goes back with its proposal, and comes back with Redo', () => {
  const G = table5(); const { log, act, ids } = G;
  const size = log.room.game.sizes[0];
  act(leader(log.room), { type: 'propose', team: ids.slice(0, size) });
  act(ids[1], { type: 'vote', approve: true }); act(ids[2], { type: 'vote', approve: false });
  assert.equal(log.history().undoLabel, 'The party proposal');
  assert.equal(log.undoStep(), 'The party proposal');
  assert.equal(log.room.phase, 'propose'); assert.deepEqual(log.room.game.votes, {});
  assert.equal(log.redoStep(), 'The party proposal');
  assert.equal(log.room.phase, 'vote'); assert.deepEqual(Object.keys(log.room.game.votes).sort(), [ids[1], ids[2]].sort());
});

test('back over a quest result everyone saw, and from the end screen: the roles are hidden again on every phone', () => {
  const G = table5(); const { log } = G;
  play(G);
  assert.equal(log.room.phase, 'over');
  const ids = log.room.players.map((p) => p.id);
  assert.ok(viewForPlayer(log.room, ids[1]).game.roles, 'the end screen shows the roles');
  const h = log.history(); assert.ok(h.canUndo, h.undoWhy);
  log.undoStep();
  assert.notEqual(log.room.phase, 'over');
  for (const id of ids) assert.ok(!viewForPlayer(log.room, id).game.roles, 'roles are hidden again');
  assert.ok(!json(viewForScreen(log.room)).includes('"roles":{'));
  // keep going back over every shown quest result
  let results = log.room.game.results.length;
  while (results > 0 && log.undoStep() !== null) results = log.room.game?.results.length ?? 0;
  assert.equal(results, 0);
  while (log.redoStep() !== null);
  assert.equal(log.room.phase, 'over');
});

test('the flags: with UNDO_PAST_RESULT or UNDO_PAST_GAME_OVER off, Undo stops there with a reason, and the game still goes on', () => {
  const G = table5(); const { log } = G;
  play(G);
  assert.equal(log.history({ pastOver: false }).canUndo, false);
  assert.match(log.history({ pastOver: false }).undoWhy, /over/);
  log.undoStep();
  while (log.room.game && !log.events.slice(0, log.cursor).some((e) => e.q)) log.undoStep();
  // now some result is behind the cursor; walk back to just after it
  let h = log.history({ pastResult: false });
  for (let k = 0; k < 50 && h.canUndo; k++) { log.undoStep({ pastResult: false }); h = log.history({ pastResult: false }); }
  assert.equal(h.canUndo, false); assert.match(h.undoWhy, /quest result/);
  assert.ok(!fallback(G).stuck, 'a host fallback still moves the game on');
});

test('a mid-game join (a watcher, or someone taking over an opened seat) is where Undo stops; Redo and the fallbacks still work', () => {
  const G = table5(); const { log, act, ids } = G;
  const size = log.room.game.sizes[0];
  act(leader(log.room), { type: 'propose', team: ids.slice(0, size) });
  act(null, { type: 'join', name: 'Late' });
  const h = log.history(); assert.equal(h.canUndo, false); assert.match(h.undoWhy, /joined/);
  assert.equal(log.undoStep(), null);
  assert.ok(!fallback(G).stuck);
  act(ids[0], { type: 'skip', id: ids[1] });
  assert.ok(log.history().canUndo, 'a step after the join can be undone');
});

test('timers, talk turns, chat and the game log come back exactly with the step (room-wide undo)', () => {
  const G = table5(); const { log, act, ids } = G;
  const before = json(log.room);
  const size = log.room.game.sizes[0];
  act(leader(log.room), { type: 'propose', team: ids.slice(0, size) });
  act(ids[0], { type: 'timer', secs: 60 }); act(ids[2], { type: 'chat', text: 'hm' }); act(ids[0], { type: 'talk', secs: 30 });
  log.undoStep();
  assert.equal(json(log.room), before);
});

// ---------- the room, with three phones ----------
function fakeCtx(store = new Map()) {
  const sockets = []; const f = { store, sockets, failPuts: 0 };
  const put1 = (k, v) => { store.set(k, structuredClone(v)); };
  f.ctx = {
    storage: {
      get: async (k) => (Array.isArray(k) ? new Map(k.filter((x) => store.has(x)).map((x) => [x, structuredClone(store.get(x))])) : structuredClone(store.get(k))),
      put: async (k, v) => { if (f.failPuts > 0) { f.failPuts--; throw new Error('storage is down'); } if (typeof k === 'object') for (const [a, b] of Object.entries(k)) put1(a, b); else put1(k, v); },
      setAlarm: async () => {}, deleteAlarm: async () => {}, deleteAll: async () => { store.clear(); },
    },
    blockConcurrencyWhile: (fn) => fn(), getWebSockets: () => sockets, acceptWebSocket: (ws) => sockets.push(ws),
  };
  return f;
}
const sock = () => ({ sent: [], att: null, send(m) { this.sent.push(JSON.parse(m)); }, close() {}, serializeAttachment(a) { this.att = a; }, deserializeAttachment() { return this.att; } });
const send = (room, ws, msg) => room.webSocketMessage(ws, JSON.stringify(msg));
const last = (ws, type) => ws.sent.filter((m) => m.type === type).at(-1);
const view = (ws) => last(ws, 'view')?.view;

async function phones(f = fakeCtx()) {
  const room = new Room(f.ctx, {}); await room.ready;
  await room.fetch(new Request('https://room/init', { method: 'POST', body: JSON.stringify({ code: 'QUNDOX', hostKey: 'hk' }) }));
  const host = sock(), a = sock(), b = sock(); f.sockets.push(host, a, b);
  await send(room, host, { type: 'hello', join: 'Hana', hostKey: 'hk' });
  await send(room, a, { type: 'hello', join: 'Ann' }); await send(room, b, { type: 'hello', join: 'Ben' });
  for (const n of ['Dee', 'Eve']) { const s = sock(); f.sockets.push(s); await send(room, s, { type: 'hello', join: n }); }
  await send(room, host, { type: 'start' }); await send(room, host, { type: 'skipReveal' });
  const rev = () => view(host).rev;
  return { f, room, host, a, b, rev };
}

test('three phones: Undo and Redo need the current rev; every phone follows; players are told; a player cannot undo', async () => {
  const { room, host, a, b, rev } = await phones();
  const g = room.room.game; const ids = room.room.players.filter((p) => !p.watch).map((p) => p.id);
  const lead = ids[g.leader % g.n]; const ws = room.ctx.getWebSockets().find((s) => s.att?.playerId === lead);
  const before = json(room.room);
  await send(room, ws, { type: 'propose', team: ids.slice(0, g.sizes[0]) });
  assert.equal(view(host).phase, 'vote');
  assert.equal(view(host).hist.undoLabel, 'The party proposal'); assert.equal(view(a).hist, undefined, 'only the host gets Undo state');
  assert.equal(typeof view(a).rev, 'number');
  await send(room, a, { type: 'undo', rev: rev() });
  assert.match(last(a, 'error').error, /host/);
  await send(room, host, { type: 'undo', rev: rev() - 1 });
  assert.match(last(host, 'error').error, /moved on/); assert.equal(view(host).phase, 'vote');
  await send(room, host, { type: 'undo' });
  assert.match(last(host, 'error').error, /moved on/, 'an Undo with no rev is refused (two taps never pop two steps)');
  await send(room, host, { type: 'undo', rev: rev() });
  assert.equal(json(room.room), before);
  for (const s of [host, a, b]) assert.equal(view(s).phase, 'propose');
  assert.equal(last(host, 'stepped').label, 'The party proposal');
  assert.deepEqual([last(a, 'stepped')?.dir, last(b, 'stepped')?.dir], ['undo', 'undo']);
  await send(room, host, { type: 'redo', rev: rev() });
  assert.equal(view(a).phase, 'vote'); assert.equal(last(a, 'stepped').dir, 'redo');
  await send(room, host, { type: 'redo', rev: rev() });
  assert.equal(last(host, 'error').error, 'Nothing to redo.');
});

test('a host entry sent against an older rev is refused and the host gets the latest view', async () => {
  const { room, host, rev } = await phones();
  const old = rev();
  await send(room, host, { type: 'timer', secs: 60 });
  const r0 = rev();
  await send(room, host, { type: 'skip', id: room.room.players[1].id, rev: old });
  assert.match(last(host, 'error').error, /moved on/); assert.equal(rev(), r0);
});

test('storage: the log is written in chunks next to room/log/undo, a cold start carries on the same log', async () => {
  const f = fakeCtx(); const { room, host, rev } = await phones(f);
  for (let i = 0; i < SNAP_EVERY + 10; i++) await send(room, host, { type: 'coin' });
  const meta = f.store.get(KEY.meta);
  assert.equal(meta.len, room.log.events.length); assert.ok(f.store.has(KEY.snap(1)));
  assert.deepEqual(f.store.get('undo'), []); assert.ok(Array.isArray(f.store.get('log')) && f.store.get('room').code === 'QUNDOX', 'an older build still finds room, log and undo');
  const again = new Room(f.ctx, {}); await again.ready;
  assert.equal(again.log.events.length, meta.len); assert.equal(again.log.rev, rev());
  assert.equal(json(again.room), json(room.room));
  assert.ok(again.log.history().canUndo);
});

test('an open room from before the log (with the old 12-step snapshot stack) loads, starts a fresh log, and plays on', async () => {
  const f = fakeCtx();
  const G = newGame(9); play(G, { max: 30 });
  const r = structuredClone(G.log.room); const { log, ...rest } = r;
  f.store.set('room', { ...rest, undo: [] }); f.store.set('log', log); f.store.set('undo', ['{"game":null,"phase":"lobby"}']);
  const room = new Room(f.ctx, {}); await room.ready;
  assert.equal(room.log.events.length, 0); assert.deepEqual(room.room.undo, []);
  assert.equal(json(room.room.game), json(G.log.room.game));
  const host = sock(); host.att = { who: 'player', playerId: G.ids[0], token: room.room.players[0].token }; f.sockets.push(host);
  await send(room, host, { type: 'coin' });
  assert.equal(room.log.events.length, 1); assert.ok(f.store.has(KEY.base));
});

test('a move storage would not keep is taken back: the room goes back to the saved one and every phone follows', async () => {
  const f = fakeCtx(); const { room, host, a } = await phones(f);
  const saved = json(room.room);
  f.failPuts = 1e9; await send(room, host, { type: 'timer', secs: 60 }); f.failPuts = 0;
  assert.equal(last(host, 'error').error, 'That move could not be saved. Try it again.');
  assert.equal(json(room.room), saved); assert.equal(view(a).timer, null);
  assert.equal(json(replay(room.log.base, room.log.events.slice(0, room.log.cursor))), json(room.room));
});
