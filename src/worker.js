// Cloudflare Worker: serves the API + WebSocket entry points. Static files come from Workers Static Assets.
import { DurableObject } from 'cloudflare:workers';
import { newRoom, reduce } from '../public/js/room.js';
import { fanout } from './fanout.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O look-alikes
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_MSG = 16 * 1024;

const randCode = () => {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return [...b].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
};
const randKey = () => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default {
  async fetch(request, env) {
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
      return json({ exists: res.status === 200 }, res.status === 200 ? 200 : 404);
    }

    const ws = url.pathname.match(/^\/ws\/([A-Za-z]{6})$/);
    if (ws) {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
      const stub = env.ROOM.get(env.ROOM.idFromName(ws[1].toUpperCase()));
      return stub.fetch(request);
    }

    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  },
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    this.ready = ctx.blockConcurrencyWhile(async () => { const m = await ctx.storage.get(['room', 'log', 'undo']); const r = m.get('room'); this.room = r ? { ...r, log: m.get('log') || r.log || [], undo: m.get('undo') || r.undo || [] } : null; });
  }

  // A failed write must never swallow a move: retry once, and if storage is still unhappy keep going with the
  // in-memory room (it is what every screen is showing) and try again on the next action.
  async save() {
    this.room.updated = Date.now();
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const { log, undo, ...rest } = this.room;
        await this.ctx.storage.put({ room: rest, log: log || [], undo: undo || [] }); // split: each value stays well under the per-value limit
        await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
        return true;
      } catch (e) {
        console.error(`save failed (attempt ${attempt}) for room ${this.room.code}:`, e?.message || e);
      }
    }
    return false;
  }

  async alarm() { await this.ctx.storage.deleteAll(); this.room = null; }

  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);
    if (url.pathname === '/init') {
      if (this.room) return new Response('exists', { status: 409 });
      const { code, hostKey } = await request.json();
      this.room = newRoom(code, hostKey);
      await this.save();
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

  broadcast(wasOver = false) {
    fanout(this.room, this.ctx.getWebSockets().map((ws) => ({ ws, att: ws.deserializeAttachment() })), this.connectedIds(), wasOver);
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
        ws.serializeAttachment({ who: 'player', playerId: p.id });
      } else if (msg.join) {
        const res = reduce(this.room, { anon: true }, { type: 'join', name: msg.join, hostKey: msg.hostKey });
        if (res.error) { this.send(ws, { type: 'error', error: res.error }); return; }
        await this.save();
        ws.serializeAttachment({ who: 'player', playerId: res.data.playerId });
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
    const actor = { playerId: att.playerId };
    const wasOver = this.room.phase === 'over';
    const res = reduce(this.room, actor, msg);
    if (res.error) { this.send(ws, { type: 'error', error: res.error }); return; }
    if (this.room.closed) { await this.closeRoom(); return; }
    await this.save();
    this.broadcast(wasOver);
  }

  // The host closed the table: tell every seat and the table screen, wipe the room and its alarm, free the code.
  async closeRoom() {
    for (const s of this.ctx.getWebSockets()) { this.send(s, { type: 'closed' }); try { s.close(1000, 'closed'); } catch { /* already gone */ } }
    this.room = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async webSocketClose(ws) { try { ws.close(); } catch { /* already closed */ } await this.ready; this.broadcast(); }
  async webSocketError() { await this.ready; this.broadcast(); }
}
