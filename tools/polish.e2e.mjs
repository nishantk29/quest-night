// Polish e2e (Oct 28 sweep). Static files come from public/, and the room WebSocket is answered in-process by public/js/room.js.
// Checks: the room code never runs under the settings button; outline buttons in the fixed action bar are opaque; segmented
// controls, dice sides and the home print link are at least 44px; a focused field is not covered by the tab bar or the action
// bar on a phone with the keyboard up.   usage: node tools/polish.e2e.mjs [repoDir]   exit 0 = pass, 1 = fail
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
// Playwright is an optional dev tool (not in package.json): `npm i --no-save playwright-core`, or set PW to its install dir.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright-core');
const repo = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(repo, 'public');
const R = await import(path.join(repo, 'public/js/room.js'));
const CODE = 'POLISH';
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const serve = (route) => { const u = new URL(route.request().url());
  if (u.pathname.startsWith('/api/room/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"exists":true}' });
  const f = path.join(pub, u.pathname === '/' ? '/index.html' : u.pathname);
  if (!f.startsWith(pub) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
  return route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f), headers: { 'cache-control': 'no-store' } }); };
const A = (room, id, msg) => { const r = R.reduce(room, { playerId: id }, msg); if (r?.error) throw new Error(`${msg.type}: ${r.error}`); };
function table({ mode, phase }) {
  const room = R.newRoom(CODE, 'hk');
  room.ids = ['Host Ana', 'Ben', 'Cal', 'Dee', 'Eve'].map((name, i) => R.reduce(room, {}, { type: 'join', name, hostKey: i ? undefined : 'hk' }).data.playerId);
  const host = room.ids[0];
  if (mode === 'physical') A(room, host, { type: 'mode', mode: { play: 'physical', roles: 'physical', votes: 'physical', cards: 'physical' } });
  if (mode === 'hybrid') A(room, host, { type: 'mode', mode: { play: 'hybrid', roles: 'physical', votes: 'app', cards: 'app' } });
  if (phase === 'lobby') return room;
  A(room, host, { type: 'start' }); for (const id of room.ids) R.reduce(room, { playerId: id }, { type: 'ready' }); if (room.phase === 'reveal') A(room, host, { type: 'skipReveal' });
  if (phase === 'propose') return room;
  const g = room.game; A(room, host, { type: 'propose', team: room.ids.slice(0, g.sizes[g.quest]) });
  return room;
}
const leaderOf = (room) => room.ids[room.game.leader % room.game.n];
async function open(browser, { w, h, room, as, hash }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/*', serve);
  if (room) {
    const socks = [];
    const send = () => { for (const s of socks) s.ws.send(JSON.stringify({ type: 'view', view: R.viewForPlayer(room, s.id, new Set(room.ids)) })); };
    await page.routeWebSocket(/\/ws\//, (ws) => { const s = { ws, id: null }; socks.push(s); ws.onMessage((raw) => { const m = JSON.parse(raw); if (m.type === 'hello' && m.playerId) { s.id = m.playerId; send(); } else if (s.id && m.type !== 'ping') { R.reduce(room, { playerId: s.id }, m); send(); } }); });
    const p = room.players.find((x) => x.id === as);
    await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [`quest.player.${CODE}`, JSON.stringify({ playerId: p.id, token: p.token })]);
  }
  await page.goto('http://game.test/' + (hash || `#/play/${CODE}`)); await page.waitForTimeout(1200);
  return { page, ctx, errs };
}
const results = []; const check = (name, pass, info) => { results.push({ name, pass, info }); console.log(`${pass ? 'ok  ' : 'FAIL'} ${name} ${JSON.stringify(info)}`); };
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
// 1. room code vs the settings button, long phase label, 375 and 390 wide
for (const w of [375, 390]) {
  const room = table({ phase: 'propose' }); const { page, ctx } = await open(browser, { w, h: 700, room, as: leaderOf(room) });
  const r = await page.evaluate(() => { const c = document.querySelector('.appbar-title .code').getBoundingClientRect(); const b = document.querySelector('.appbar .icon-btn, .appbar button'); const bb = b.getBoundingClientRect(); const badge = document.querySelector('.phase-badge').getBoundingClientRect(); return { codeRight: Math.round(c.right), btnLeft: Math.round(bb.left), badgeRight: Math.round(badge.right), badgeTop: Math.round(badge.top), btnTop: Math.round(bb.top), vw: innerWidth }; });
  check(`appbar code clear of the settings button at ${w}`, r.codeRight <= r.btnLeft && r.badgeRight <= r.vw && r.badgeTop < r.btnTop + 44, r); await ctx.close();
}
// 2. outline buttons in the fixed action bar are opaque (physical vote: "No one approved" over the phase panel)
{ const room = table({ mode: 'physical', phase: 'vote' }); const { page, ctx } = await open(browser, { w: 390, h: 844, room, as: room.ids[0] });
  const r = await page.evaluate(() => [...document.querySelectorAll('.sticky-act .btn.ghost')].map((b) => { const c = getComputedStyle(b).backgroundColor; const m = c.match(/[\d.]+/g).map(Number); return { t: b.textContent.trim(), c, a: m.length > 3 ? m[3] : 1 }; }));
  check('fixed-bar outline buttons are opaque', r.length > 0 && r.every((x) => x.a >= 0.95), r); await ctx.close(); }
// 3. 44px targets: hybrid piece switches, log filters, dice sides, home print link
{ const room = table({ mode: 'hybrid', phase: 'lobby' }); const { page, ctx } = await open(browser, { w: 390, h: 844, room, as: room.ids[0] });
  const piece = await page.$$eval('[data-a="piece"]', (x) => x.map((e) => Math.round(e.getBoundingClientRect().height)));
  await page.evaluate(() => document.querySelector('[data-a="tab"][data-v="log"]')?.click()); await page.waitForTimeout(300);
  const log = await page.$$eval('[data-a="logFilter"]', (x) => x.map((e) => Math.round(e.getBoundingClientRect().height)));
  await page.evaluate(() => document.querySelector('[data-a="tab"][data-v="tools"]')?.click()); await page.waitForTimeout(300);
  const dice = await page.$$eval('[data-a="dSides"]', (x) => x.map((e) => Math.round(Math.min(e.getBoundingClientRect().height, e.getBoundingClientRect().width))));
  const all = [...piece, ...log, ...dice];
  check('segmented controls are 44px tall', all.length >= 8 && all.every((x) => x >= 44), { piece, log, dice }); await ctx.close(); }
{ const { page, ctx } = await open(browser, { w: 390, h: 844, hash: '#/' });
  const r = await page.$eval('a[href="/print.html"]', (e) => Math.round(e.getBoundingClientRect().height));
  check('home print link is 44px tall', r >= 44, { h: r }); await ctx.close(); }
// 4. typing on a phone: the focused field (and its Add Seat button) are not under the tab bar or the action bar
for (const w of [375, 390]) {
  const room = table({ phase: 'lobby' }); const { page, ctx } = await open(browser, { w, h: 844, room, as: room.ids[0] });
  await page.focus('[data-i="seatName"]'); await page.setViewportSize({ width: w, height: 470 }); await page.waitForTimeout(400);
  const r = await page.evaluate(() => { const f = document.activeElement; f.scrollIntoView({ block: 'nearest' }); const rects = [f, document.querySelector('[data-a="addSeat"]')].map((e) => e.getBoundingClientRect());
    const cov = []; for (const e of document.querySelectorAll('.tabbar, .sticky-act')) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') continue; const b = e.getBoundingClientRect(); for (const r of rects) if (b.height && b.top < r.bottom - 2 && b.bottom > r.top + 2) cov.push(e.className); }
    return { focused: f.dataset.i, cov }; });
  check(`field not covered while typing at ${w}`, r.focused === 'seatName' && r.cov.length === 0, r);
  await page.evaluate(() => document.activeElement.blur()); await page.setViewportSize({ width: w, height: 844 }); await page.waitForTimeout(300);
  const back = await page.evaluate(() => getComputedStyle(document.querySelector('.tabbar')).display !== 'none');
  check(`tab bar comes back after typing at ${w}`, back, { back }); await ctx.close();
}
await browser.close();
const fail = results.filter((r) => !r.pass).length; console.log(`${results.length - fail} pass / ${fail} fail`); process.exit(fail ? 1 : 0);
