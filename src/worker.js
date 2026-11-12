// Cloudflare Worker: serves the API + WebSocket entry points. Static files come from Workers Static Assets.
import { DurableObject } from 'cloudflare:workers';
import { newRoom, viewForScreen } from '../public/js/room.js';
import { GameLog, KEY, LOG_VERSION, chunkOf } from '../public/js/event-log.js';
import { NOTIFY_ON_UNDO } from '../public/js/config-defaults.js';
import { fanout, seatStale } from './fanout.js';
import { errorResponse } from './error-page.js';
import { handleAiInternal } from './ai.js';
import { askRule } from './ask.js';
import { RULES_INDEX, RULES_HASH } from './rules-index.js';

const AI_SITE = 'quest';
const AI_GAME = 'Quest Night';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O look-alikes
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_MSG = 16 * 1024;

const randCode = () => {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return [...b].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
};
const randKey = () => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const wantsHtml = (request) => (request.headers.get('accept') || '').includes('text/html');

export default {
  // Any throw becomes a styled page (or JSON for API callers); the error itself only goes to the log.
  async fetch(request, env) {
    try { return await route(request, env); } catch (e) {
      console.error('worker error:', e?.message || e);
      return new URL(request.url).pathname.startsWith('/api/') && !wantsHtml(request) ? json({ error: 'Something went wrong. Try again.' }, 500) : errorResponse(500);
    }
  },
};

async function route(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/create' && request.method === 'POST') {
      for (let i = 0; i < 5; i++) {
        const code = randCode();
        const stub = env.ROOM.get(env.ROOM.idFromName(code));
        const res = await stub.fetch('https://room/init', { method: 'POST', body: JSON.stringify({ code, hostKey: randKey() }) });
        if (res.status === 200) return json(await res.json());
      }
      return json({ error: 'Could not create a room. Try again.' }, 503);
    }

    const exists = url.pathname.match(/^\/api\/room\/([A-Z]{6})$/);
    if (exists) {
      const stub = env.ROOM.get(env.ROOM.idFromName(exists[1]));
      const res = await stub.fetch('https://room/exists');
      return json({ exists: res.status === 200 });
    }

    const ws = url.pathname.match(/^\/ws\/([A-Za-z]{6})$/);
    if (ws) {
      if (request.headers.get('Upgrade') !== 'websocket') return errorResponse(426);
      const stub = env.ROOM.get(env.ROOM.idFromName(ws[1].toUpperCase()));
      return stub.fetch(request);
    }

    // Ask a rule (server only, no UI yet). Reads the rules text, never a room. Any failure answers { answer: null }.
    if (url.pathname === '/api/ask' && request.method === 'POST') {
      let q = ''; try { const t = await request.text(); if (t.length <= 2048) q = String(JSON.parse(t)?.q ?? ''); } catch { /* bad body: answer null */ }
      const r = await askRule(env, { site: AI_SITE, game: AI_GAME, index: RULES_INDEX, rulesVersion: RULES_HASH, question: q });
      return new Response(JSON.stringify(r), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }

    if (url.pathname.startsWith('/api/')) return wantsHtml(request) ? errorResponse(404) : json({ error: 'Not found' }, 404);
    const res = env.ASSETS ? await env.ASSETS.fetch(request) : null;
    return res && res.status !== 404 ? res : errorResponse(404);
}

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    this.log = null; // GameLog: every change to the room as an event (public/js/event-log.js)
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const m = await ctx.storage.get(['room', 'log', 'undo']); const r = m.get('room');
      this.room = r ? { ...r, log: m.get('log') || r.log || [], undo: [] } : null; // the old snapshot stack is replaced by the log
      if (this.room) await this.loadLog();
    });
  }

  // The event log lives next to `room` (and its `log` and `undo` keys, which an older build still reads):
  // elog:meta, elog:base, elog:c:<k> (events in chunks of SNAP_EVERY) and elog:s:<k> (a checkpoint every SNAP_EVERY
  // events). Loading replays from the last checkpoint and must give back the stored room exactly. A room from before
  // the log, or a log an older build left out of step (after a rollback), starts a fresh log from the room.
  async loadLog() {
    const st = this.ctx.storage; const meta = await st.get(KEY.meta);
    try {
      if (meta?.v === LOG_VERSION && meta.len >= meta.cursor && meta.cursor >= 0) {
        const events = [];
        for (let k = 0; k * meta.snapEvery < meta.len; k++) events.push(...((await st.get(KEY.chunk(k))) || []));
        if (events.length >= meta.len) {
          events.length = meta.len;
          const snaps = [];
          for (let k = 1; k * meta.snapEvery <= meta.len; k++) { const s = await st.get(KEY.snap(k)); if (s) snaps.push([k * meta.snapEvery, s]); }
          const log = GameLog.restore({ base: await st.get(KEY.base), events, cursor: meta.cursor, rev: meta.rev, snaps }, { snapEvery: meta.snapEvery });
          if (sameRoom(log.room, this.room)) { this.log = log; this.room = log.room; this.dirty = null; return; }
        }
      }
    } catch (e) { console.error(`event log unreadable for room ${this.room.code}, starting a fresh one:`, e?.message || e); }
    this.startLog();
  }
  startLog() {
    this.log = new GameLog(this.room);
    this.room = this.log.room;
    this.dirty = { base: true, from: 0 };
  }
  metaOf() { const L = this.log; return { v: LOG_VERSION, rev: L.rev, cursor: L.cursor, len: L.events.length, snapEvery: L.snapEvery }; }
  markDirty(from) { this.dirty ||= {}; this.dirty.from = Math.min(this.dirty.from ?? from, from); }

  // Every change to the room goes through here: the message is applied as an event and kept if it changed the room.
  // A new move after Undo drops the steps that were undone (the redo branch).
  apply(actor, msg) {
    const r = this.log.apply(actor, msg, Date.now());
    this.room = this.log.room;
    if (r.kept) {
      this.markDirty(this.log.cursor - 1);
      if (this.log.events.length >= MAX_EVENTS && ['lobby', 'over'].includes(this.room.phase)) this.startLog(); // keep a long-running room's log bounded, at a game boundary
    }
    return r;
  }

  // The room (split as before into room, log and undo), the log meta, the changed chunks and any new checkpoints go
  // out together: puts with no await between them are one atomic write in a Durable Object.
  writes() {
    const L = this.log; const { log, undo, ...rest } = this.room;
    const out = { room: rest, log: log || [], undo: [], [KEY.meta]: this.metaOf() };
    if (!this.dirty) return out;
    if (this.dirty.base) out[KEY.base] = L.base;
    const len = L.events.length; const E = L.snapEvery;
    for (let k = chunkOf(this.dirty.from ?? len, E); k * E < len; k++) out[KEY.chunk(k)] = L.events.slice(k * E, (k + 1) * E);
    for (const [i, s] of L.snaps) if (i > (this.dirty.from ?? len) && i <= len) out[KEY.snap(i / E)] = s;
    return out;
  }

  // One write with a retry. Returns false if storage refused both times (see commit).
  async save() {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await this.ctx.storage.put(this.writes());
        this.dirty = null;
        await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
        return true;
      } catch (e) {
        console.error(`save failed (attempt ${attempt}) for room ${this.room.code}:`, e?.message || e);
      }
    }
    return false;
  }

  // Save a move, or take it back. A move storage would not keep must not stay on the phones: an evicted DO would
  // come back without it. So on a failed save the room goes back to what storage holds, the sender is told, and every
  // phone gets the saved room. Returns whether the move was kept.
  async commit(ws) {
    if (await this.save()) return true;
    try {
      const m = await this.ctx.storage.get(['room', 'log']); const r = m.get('room');
      if (r) { this.room = { ...r, log: m.get('log') || r.log || [], undo: [] }; await this.loadLog(); }
    } catch (e) { console.error(`reload after a failed save failed for room ${this.room?.code}:`, e?.message || e); }
    this.send(ws, { type: 'error', error: 'That move could not be saved. Try it again.' });
    this.broadcast();
    return false;
  }

  async alarm() { await this.ctx.storage.deleteAll(); this.room = null; }

  async fetch(request) {
    await this.ready;
    const aiInternal = await handleAiInternal(this.ctx.storage, request); // reserved budget and cache instances only
    if (aiInternal) return aiInternal;
    const url = new URL(request.url);
    if (url.pathname === '/init') {
      if (this.room) return new Response('exists', { status: 409 });
      const { code, hostKey } = await request.json();
      this.room = newRoom(code, hostKey);
      this.startLog();
      if (!(await this.save())) { this.room = null; this.log = null; return new Response('storage', { status: 503 }); } // the caller tries another code
      return new Response(JSON.stringify({ code, hostKey }), { status: 200 });
    }
    if (url.pathname === '/exists') return new Response(null, { status: this.room ? 200 : 404 });

    if (!this.room) return new Response('Room not found', { status: 404 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ who: null });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  connectedIds() {
    const s = new Set();
    for (const ws of this.ctx.getWebSockets()) { const a = ws.deserializeAttachment(); if (a?.playerId) s.add(a.playerId); }
    return s;
  }

  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch { /* socket gone */ } }

  // Each view carries the log's revision; the host's also says what Undo and Redo would do.
  broadcast(wasOver = false) {
    if (!this.room) return;
    fanout(this.room, this.ctx.getWebSockets().map((ws) => ({ ws, att: ws.deserializeAttachment() })), this.connectedIds(), wasOver, { rev: this.log.rev, hist: this.log.history() });
  }
  hostSocket(att) { return att?.who === 'player' && !!this.room.players.find((p) => p.id === att.playerId)?.host; }
  resend(ws) { fanout(this.room, [{ ws, att: ws.deserializeAttachment() }], this.connectedIds(), true, { rev: this.log.rev, hist: this.log.history() }); }

  // Undo / Redo (host only): one step back or forward on the log. The room is rebuilt by replay, so the votes, quest
  // results, timers, chat and the log are exactly what they were at that step.
  async step(ws, msg) {
    const dir = msg.type === 'undo' ? 'undo' : 'redo';
    if (typeof msg.rev !== 'number' || msg.rev !== this.log.rev) { this.send(ws, { type: 'error', error: 'The game moved on. Showing the latest.' }); this.resend(ws); return; }
    const before = this.room; const was = publicFace(before);
    const why = dir === 'undo' ? this.log.history().undoWhy : 'Nothing to redo.';
    const label = dir === 'undo' ? this.log.undoStep() : this.log.redoStep();
    if (label === null) { this.send(ws, { type: 'error', error: why || 'Nothing to undo.' }); return; }
    this.room = this.log.room;
    if (!(await this.commit(ws))) return;
    this.broadcast(before.phase === 'over');
    this.send(ws, { type: 'stepped', dir, label, host: true });
    if (NOTIFY_ON_UNDO && publicFace(this.room) !== was) {
      for (const s of this.ctx.getWebSockets()) if (s !== ws && s.deserializeAttachment()?.who) this.send(s, { type: 'stepped', dir });
    }
  }

  async webSocketMessage(ws, raw) {
    await this.ready;
    if (!this.room) { this.send(ws, { type: 'fatal', error: 'Room expired.' }); ws.close(1000, 'gone'); return; }
    if (typeof raw !== 'string' || raw.length > MAX_MSG) return;
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const att = ws.deserializeAttachment() || { who: null };

    // ---- handshake ----
    if (msg.type === 'hello') {
      if (msg.playerId) {
        const p = this.room.players.find((x) => x.id === msg.playerId);
        if (!p || p.token !== msg.token) { this.send(ws, { type: 'fatal', error: 'Could not rejoin. Join again with a new name.', clear: true }); ws.close(1008, 'bad token'); return; }
        ws.serializeAttachment({ who: 'player', playerId: p.id, token: p.token });
      } else if (msg.join) {
        const res = this.apply({ anon: true }, { type: 'join', name: msg.join, hostKey: msg.hostKey });
        if (res.error) { if (res.kept) await this.commit(ws); this.send(ws, { type: 'error', error: res.error }); return; }
        if (!(await this.commit(ws))) return;
        ws.serializeAttachment({ who: 'player', playerId: res.data.playerId, token: res.data.token });
        this.send(ws, { type: 'joined', ...res.data });
      } else if (msg.screen) { // the shared table screen: public view only
        ws.serializeAttachment({ who: 'screen' });
      } else {
        // Watching before joining: show the lobby so the join form knows the room is open.
        this.send(ws, { type: 'lobby', phase: this.room.phase, count: this.room.players.length }); return;
      }
      this.broadcast();
      return;
    }
    if (!att.who || att.who === 'screen') return;

    // ---- actions ----
    if (att.who === 'player' && seatStale(this.room, att)) { this.send(ws, { type: 'fatal', error: 'The host opened your seat for someone else.', clear: true }); ws.serializeAttachment({ who: null }); return; }
    // ---- back and forward (host only) ----
    if (msg.type === 'undo' || msg.type === 'redo') {
      if (!this.hostSocket(att)) { this.send(ws, { type: 'error', error: 'Only the host can do that.' }); return; }
      await this.step(ws, msg);
      return;
    }
    const actor = { playerId: att.playerId };
    // A host message sent against an older revision (a second phone, a late retry) is refused, never applied to a
    // later step. Messages that carry no `rev` are not checked.
    if (typeof msg.rev === 'number' && this.hostSocket(att) && msg.rev !== this.log.rev) { this.send(ws, { type: 'error', error: 'The game moved on. Showing the latest.' }); this.resend(ws); return; }
    const { rev: _rev, ...intent } = msg;
    const wasOver = this.room.phase === 'over';
    const res = this.apply(actor, intent);
    if (res.error) { if (res.kept) await this.commit(ws); this.send(ws, { type: 'error', error: res.error }); return; }
    if (this.room.closed) { await this.closeRoom(); return; }
    if (!(await this.commit(ws))) return;
    this.broadcast(wasOver);
  }

  // The host closed the table: tell every seat and the table screen, wipe the room and its alarm, free the code.
  async closeRoom() {
    for (const s of this.ctx.getWebSockets()) { this.send(s, { type: 'closed' }); try { s.close(1000, 'closed'); } catch { /* already gone */ } }
    this.room = null; this.log = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async webSocketClose(ws) { try { ws.close(); } catch { /* already closed */ } await this.ready; this.broadcast(); }
  async webSocketError() { await this.ready; this.broadcast(); }
}

// What every phone can see of the game (the table screen's view of it). Undo or Redo that changes none of it (a chat
// line, a timer) is not announced to players.
const publicFace = (r) => JSON.stringify([r.phase, viewForScreen(r).game]); // exactly what the table screen shows of the game
const MAX_EVENTS = 6000;
// The stored room comes back as three keys (room, log, undo), so its `log` and `undo` sit in another place in the
// object: compare without them, then the log itself.
function sameRoom(a, b) {
  const { log: la, undo: _ua, ...ra } = a; const { log: lb, undo: _ub, ...rb } = b;
  return JSON.stringify(ra) === JSON.stringify(rb) && JSON.stringify(la || []) === JSON.stringify(lb || []);
}
