// E2E (browser, Chromium): the Table tab under live updates (playtest feedback, Oct 29 2026: "Table screen is sooooo janky"; same fix as Gilded).
// A host phone in a real room with five scripted phones (raw WebSockets) that vote, chat, flip coins and roll dice.
// Asserts: no update replaces a child of #app (patched, not rebuilt); the quest track, every seat and the tab bar are the SAME
// nodes after 12 updates; CLS < 0.1; the reader's scroll position holds; a chat read further up keeps its place while
// new lines arrive (and one read to the bottom follows them); tab switches keep the tab bar node; no console errors.
// Run: node test/e2e/table-jank.e2e.mjs   (starts wrangler dev)   or BASE=https://<host> (live; closes its room)
import { fileURLToPath } from 'node:url';
import { ledger, server, launch, phone } from './phones.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const L = ledger('quest table-jank e2e');
const srv = await server(ROOT);
const browser = await launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(100); } return false; };
function bot(code, name, hostKey) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`${srv.base.replace(/^http/, 'ws')}/ws/${code}`); const b = { name, ws, view: null, creds: null };
    b.send = (m) => ws.send(JSON.stringify(m));
    ws.onopen = () => b.send({ type: 'hello', join: name, hostKey });
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'joined') b.creds = { playerId: m.playerId, token: m.token }; if (m.type === 'view') b.view = m.view; if (b.creds && b.view && !b.ok) { b.ok = true; res(b); } };
    ws.onerror = () => rej(new Error(`bot ${name}`)); setTimeout(() => rej(new Error(`bot ${name} timed out`)), 30000);
  });
}
let host; let room; const bots = [];
try {
  room = await fetch(`${srv.base}/api/create`, { method: 'POST' }).then((r) => r.json());
  const hb = await bot(room.code, 'E2E Hal', room.hostKey);
  for (const n of ['E2E Ana', 'E2E Ben', 'E2E Cal', 'E2E Dee', 'E2E Eve']) bots.push(await bot(room.code, n));
  hb.send({ type: 'start' }); await until(() => hb.view.phase === 'reveal');
  for (const b of [hb, ...bots]) b.send({ type: 'ready' }); await until(() => hb.view.phase === 'propose');
  // the leader proposes a party so the votes can come in while the host watches the Table tab
  const g = hb.view.game; const all = [hb, ...bots]; const lead = all.find((b) => b.creds.playerId === g.leader) || hb;
  lead.send({ type: 'propose', team: hb.view.players.slice(0, g.sizes[g.quest]).map((p) => p.id) }); await until(() => hb.view.phase === 'vote');
  hb.ws.close();
  host = await phone(browser, srv.base, 'host');
  await host.ctx.addInitScript(({ code, creds, hostKey }) => {
    localStorage.setItem(`quest.player.${code}`, JSON.stringify(creds)); localStorage.setItem(`quest.host.${code}`, hostKey);
    window.__cls = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch { /* not Chromium */ }
  }, { code: room.code, creds: hb.creds, hostKey: room.hostKey });
  await host.goto(`/#/play/${room.code}`);
  await host.page.waitForSelector('.tabbar', { timeout: 30000 }); await host.page.waitForSelector('.servant', { timeout: 30000 });
  L.check('host phone is on the Table tab with the seats', (await host.page.locator('.servant').count()) === 6, String(await host.page.locator('.servant').count()));
  // mark the nodes, then let 12 live updates arrive
  await host.page.evaluate(() => {
    window.scrollTo(0, 240);
    const app = document.getElementById('app'); window.__swaps = 0;
    new MutationObserver((ms) => { for (const m of ms) if (m.target === app && m.addedNodes.length) window.__swaps++; }).observe(app, { childList: true });
    window.__marked = { boards: document.querySelector('.track'), seats: [...document.querySelectorAll('.servant')], tabbar: document.querySelector('.tabbar'), layout: document.querySelector('.layout') };
    window.__cls = 0;
  });
  const y0 = await host.page.evaluate(() => scrollY);
  for (let i = 0; i < 12; i++) {
    const b = bots[i % bots.length];
    if (i < 4) b.send({ type: 'vote', approve: i % 2 === 0 });
    else if (i % 3 === 0) b.send({ type: 'coin' }); else if (i % 3 === 1) b.send({ type: 'dice', count: 2, sides: 6 }); else b.send({ type: 'chat', text: `Line ${i}` });
    await sleep(200);
  }
  await sleep(1200);
  const r = await host.page.evaluate(() => { const m = window.__marked; return {
    swaps: window.__swaps, cls: window.__cls, y: scrollY,
    boards: m.boards === document.querySelector('.track') && m.boards.isConnected,
    seats: m.seats.every((s, i) => s.isConnected && s === document.querySelectorAll('.servant')[i]),
    tabbar: m.tabbar === document.querySelector('.tabbar'), layout: m.layout === document.querySelector('.layout'),
    voted: Number(document.querySelector('[data-roll="voted"]')?.textContent || 0) }; });
  L.check('12 live updates replaced no child of #app (patched, not rebuilt)', r.swaps === 0, `swaps ${r.swaps}`);
  L.check('the quest track, all six seats, the layout and the tab bar are the same nodes after the updates', r.boards && r.seats && r.tabbar && r.layout, r);
  L.check('the updates were applied (the felt counts the votes)', r.voted >= 4, `voted ${r.voted}`);
  L.check('CLS during the updates < 0.1', r.cls < 0.1, r.cls.toFixed(4));
  L.check('the reader keeps their scroll position', Math.abs(r.y - y0) <= 2, `${y0} -> ${r.y}`);
  // Chat: read further up while new lines arrive, then read to the bottom and follow them
  await host.page.locator('.tabbar [data-v="chat"]').click();
  await host.page.waitForSelector('.chat .msgs');
  const tabbarKept = await host.page.evaluate(() => window.__marked.tabbar === document.querySelector('.tabbar'));
  L.check('switching tabs keeps the tab bar node', tabbarKept);
  for (let i = 0; i < 8; i++) { bots[i % 5].send({ type: 'chat', text: `Filler line ${i} so the list scrolls a little further down the screen` }); await sleep(150); }
  await sleep(800);
  await host.page.evaluate(() => { document.querySelector('.chat .msgs').scrollTop = 0; });
  bots[0].send({ type: 'chat', text: 'New while reading up' }); await sleep(1000);
  const up = await host.page.evaluate(() => document.querySelector('.chat .msgs').scrollTop);
  L.check('a chat read further up keeps its place when a line arrives', up === 0, `scrollTop ${up}`);
  await host.page.evaluate(() => { const el = document.querySelector('.chat .msgs'); el.scrollTop = el.scrollHeight; });
  bots[1].send({ type: 'chat', text: 'New at the bottom' }); await sleep(1000);
  const bottom = await host.page.evaluate(() => { const el = document.querySelector('.chat .msgs'); return el.scrollHeight - el.scrollTop - el.clientHeight; });
  L.check('a chat read to the bottom follows new lines', bottom < 40, `${bottom}px from the bottom`);
  L.check('no console or page errors on the host phone', host.errors.length === 0, host.errors.slice(0, 3));
} catch (e) {
  L.check(`run finished without throwing`, false, String(e.message || e).split('\n')[0]);
} finally {
  try { if (room) { const c = host && (await host.page.evaluate((k) => localStorage.getItem(k), `quest.player.${room.code}`).catch(() => null)); const h = new WebSocket(`${srv.base.replace(/^http/, 'ws')}/ws/${room.code}`); await new Promise((r) => { h.onopen = () => { h.send(JSON.stringify({ type: 'hello', ...JSON.parse(c || '{}') })); setTimeout(() => { h.send(JSON.stringify({ type: 'close' })); setTimeout(r, 800); }, 800); }; setTimeout(r, 5000); }); } } catch { /* the chamber expires on its own */ }
  for (const b of bots) { try { b.ws.close(); } catch { /* gone */ } }
  await browser.close(); srv.stop();
  L.done();
}
