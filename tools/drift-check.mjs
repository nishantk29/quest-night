// Sideways-drift audit: `node tools/drift-check.mjs` (exit 1 on any offender). Drives every reachable screen on an
// iPhone-sized viewport against an in-process room (the real reducer + fan-out; no wrangler), then checks that nothing
// is wider than the viewport and that a sideways swipe leaves scrollX / visualViewport.offsetLeft at 0.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newRoom, reduce } from '../public/js/room.js';
import { fanout } from '../src/fanout.js';

const puppeteer = createRequire('/workspace/code-team/bugsweep/pp/node_modules/')('puppeteer-core');
const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { js: 'text/javascript', css: 'text/css', html: 'text/html', png: 'image/png', svg: 'image/svg+xml', woff2: 'font/woff2', webmanifest: 'application/manifest+json', pdf: 'application/pdf' };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CODE = 'DRIFTA';
const GO = /^(start|ready|skipReveal|pickPlayer|pick|propose|vote|questResult|play|skip|strikeSend|strike|examine|hostStrike|again|tallySend)$/;

// ---- in-process room + static server
const room = newRoom(CODE, 'hk');
const socks = new Set(); let nextId = 0;
const broadcast = (wasOver = false) => fanout(room, [...socks].map((s) => ({ ws: s, att: s.att })), new Set([...socks].map((s) => s.att.playerId).filter(Boolean)), wasOver);
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let p = u.pathname === '/' ? '/index.html' : u.pathname;
  if (p === '/api/create') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ code: CODE, hostKey: 'hk' })); }
  if (p.startsWith('/api/room/')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"exists":true}'); }
  const f = path.join(PUB, p);
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f).slice(1)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(fs.readFileSync(f));
}).listen(0);
await new Promise((r) => server.once('listening', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---- browser
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 8000, args: ['--no-sandbox', '--disable-features=OverscrollHistoryNavigation'] });
const offenders = []; const seen = new Set(); let screens = 0;
const T0 = Date.now(); const HARD = 170000; // hard cap on the whole run; report what finished
const finish = async (note) => {
  if (note) offenders.push(note);
  console.log(`drift-check: ${screens} screens, ${offenders.length} offender(s)`);
  for (const o of offenders) console.log(' ✗ ' + o);
  await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]); server.close();
  process.exit(offenders.length ? 1 : 0);
};
setTimeout(() => finish(`hard timeout ${HARD / 1000}s hit`), HARD).unref();

async function newPage() {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message)); page.on('console', (m) => m.type() === 'error' && console.error('console', m.text()));
  await page.setUserAgent(UA); await page.setViewport(VIEWPORT);
  await page.exposeFunction('__ws', (id, data) => {
    const s = [...socks].find((x) => x.id === id); if (!s) return;
    const msg = JSON.parse(data);
    if (msg.type === 'hello') {
      if (msg.playerId) s.att = { who: 'player', playerId: msg.playerId };
      else if (msg.join) { const r = reduce(room, { anon: true }, { type: 'join', name: msg.join, hostKey: msg.hostKey }); if (r.error) return s.send(JSON.stringify({ type: 'error', error: r.error })); s.att = { who: 'player', playerId: r.data.playerId }; s.send(JSON.stringify({ type: 'joined', ...r.data })); }
      else if (msg.screen) s.att = { who: 'screen' };
      return broadcast();
    }
    if (!s.att?.playerId) return;
    const wasOver = room.phase === 'over'; const r = reduce(room, { playerId: s.att.playerId }, msg);
    if (r.error) return s.send(JSON.stringify({ type: 'error', error: r.error })); broadcast(wasOver);
  });
  // register each page-side socket with node under a node-unique id
  await page.exposeFunction('__wsOpen', () => { const s = { id: ++nextId, page, att: null, send: (d) => page.evaluate((x) => window.__recv?.(x), d).catch(() => {}) }; socks.add(s); return s.id; });
  await page.evaluateOnNewDocument(() => {
    const live = new Map();
    window.__recv = (d) => { for (const w of live.values()) w.onmessage?.({ data: d }); };
    window.WebSocket = class { constructor() { this.readyState = 0; window.__wsOpen().then((id) => { this.id = id; live.set(id, this); this.readyState = 1; this.onopen?.(); }); }
      send(d) { window.__ws(this.id, d); } close() { live.delete(this.id); this.readyState = 3; this.onclose?.(); } };
  });
  return page;
}

// ---- measuring
const measure = () => {
  const iw = innerWidth; const bad = [];
  const clipped = (el) => { for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o !== 'visible') return true; } return false; };
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('svg') && el.tagName !== 'svg') continue;
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect(); if (!r.width && !r.height) continue;
    if ((r.right > iw + 0.5 || r.left < -0.5) && !clipped(el)) bad.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} [${Math.round(r.left)}..${Math.round(r.right)}] w${Math.round(r.width)}`);
  }
  return { sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, iw, bad: bad.slice(0, 6), nbad: bad.length };
};
// OverscrollHistoryNavigation is off: a rightward drag at scrollX 0 would otherwise trigger Chrome's history-back gesture.
const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const probe = (page) => page.evaluate(() => ({ scrollX: window.scrollX, off: visualViewport.offsetLeft, scale: visualViewport.scale }));
async function swipe(page) {
  const c = await page.createCDPSession(); const t = (type, x) => c.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: 430 }] });
  await t('touchStart', 330); for (let x = 330; x >= 110; x -= 33) await t('touchMove', x); await t('touchEnd'); await sleep(100);
  const left = await probe(page);
  await t('touchStart', 110); for (let x = 110; x <= 330; x += 33) await t('touchMove', x); await t('touchEnd'); await sleep(100);
  const right = await probe(page); await c.detach();
  return { scrollX: left.scrollX || right.scrollX, off: left.off || right.off, scale: right.scale };
}
async function check(page, label) {
  if (seen.has(label) || /undefined\|undefined/.test(label)) return; seen.add(label); screens++; if (process.env.TRACE) console.error(Math.round((Date.now() - T0) / 1000) + 's', label);
  const m = await page.evaluate(measure); const s = await swipe(page);
  const why = [];
  if (m.sw > m.iw || m.bw > m.iw) why.push(`scrollWidth ${m.sw}/${m.bw} > ${m.iw}`);
  if (m.nbad) why.push(`${m.nbad} past edge: ${m.bad.join('; ')}`);
  if (s.scrollX !== 0 || s.off !== 0 || s.scale !== 1) why.push(`after swipe scrollX=${s.scrollX} offsetLeft=${s.off} scale=${s.scale}`);
  if (why.length) offenders.push(`${label}: ${why.join(' | ')}`);
}
const fingerprint = (page) => page.evaluate(() => `${document.documentElement.dataset.phase}|${document.querySelector('.phase-title,h1')?.textContent?.slice(0, 30)}|${!!document.querySelector('.vc-wrap')}|${!!document.querySelector('.qr-full')}|${document.querySelector('.stage .block-title')?.textContent}`);
const closePage = async (p) => { for (const s of [...socks]) if (s.page === p) socks.delete(s); await p.browserContext().close(); };
const click = (page, sel) => page.evaluate((s) => { document.activeElement?.blur?.(); const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);
const setName = async (page, sel, v) => { await page.waitForSelector(sel, { timeout: 6000 }).catch(async (e) => { console.error(page.url(), (await page.evaluate(() => document.body.innerText)).slice(0, 300)); throw e; }); await page.click(sel, { clickCount: 3 }); await page.type(sel, v); };

// ---- static screens
const p0 = await newPage();
for (const [name, hash] of [['home', '#/'], ['rules', '#/rules'], ['faq', '#/faq']]) {
  await p0.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle0' }); await p0.evaluate((h) => { location.hash = h; }, hash); await sleep(500); await check(p0, `static:${name}`);
}
await p0.goto(`${BASE}/print.html`, { waitUntil: 'networkidle0' }); await sleep(400); await check(p0, 'static:print.html');
await p0.close();

// ---- live game: host + 5 players + the table screen, in each mode
const MODES = { phone: { play: 'phone' }, physical: { play: 'physical' }, hybrid: { play: 'hybrid', roles: 'physical', votes: 'app', cards: 'app' } };
const step = async (pages, tag) => {
  let idle = 0;
  for (let n = 0; n < 700 && idle < 25 && Date.now() - T0 < HARD - 10000; n++) {
    let acted = false;
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i]; await check(p, `${tag}:${i ? 'p' : 'host'}:${await fingerprint(p)}`);
      if (n % 3 === 0 && await p.$('.vc-wrap')) { // game over
        await sleep(300); await check(p, `${tag}:victory:${i}`); if (i === 0) return true;
      }
      const hit = await p.evaluate((src) => { const re = new RegExp(src); const v = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const bs = [...document.querySelectorAll('[data-a]')].filter((b) => v(b) && !b.disabled && !b.classList.contains('disabled') && b.getAttribute('aria-disabled') !== 'true' && re.test(b.dataset.a));
        const b = bs.find((x) => /^(start|propose|ready|skipReveal)$/.test(x.dataset.a)) || bs[Math.floor(Math.random() * bs.length)]; if (b) b.click(); return !!b; }, GO.source);
      await sleep(40); await p.evaluate(() => document.querySelector('dialog.confirm-sheet [data-a="confirmYes"]')?.click());
      acted ||= hit;
    }
    if (process.env.TRACE && n % 25 === 0) console.error('loop', n, idle, await pages[1].evaluate(() => document.body.innerText.slice(0, 200).replace(/\n/g, ' | ')).catch(() => '?'));
    idle = acted ? 0 : idle + 1; await sleep(120);
  }
  return false;
};
for (const [name, mode] of Object.entries(MODES).filter(([n]) => !process.env.ONLY || n === process.env.ONLY)) {
  room.phase = 'lobby'; room.game = null; room.players.length = 0; room.log = []; room.undo = []; room.mode = { ...room.mode };
  const pages = [await newPage()];
  const host = pages[0]; await host.goto(BASE, { waitUntil: 'networkidle0' });
  await setName(host, '[data-i="hostName"]', 'Host'); await click(host, '[data-a="host"]'); await sleep(800);
  const code = CODE;
  if (process.env.VERBOSE) { await sleep(1500); console.log('host after create:', await host.evaluate(() => location.hash + ' | ' + document.body.innerText.slice(0, 200).replace(/\n/g, ' ')), room.players.length, socks.size); }
  await sleep(800); if (await host.$('[data-a="join"]')) await click(host, '[data-a="join"]'); await sleep(500);
  for (let i = 1; i < 6; i++) { const p = await newPage(); await p.goto(`${BASE}/#/play/${code}`, { waitUntil: 'networkidle0' }); await setName(p, '[data-i="joinName"]', `Player${i}longname`); await click(p, '[data-a="join"]'); pages.push(p); await sleep(200); }
  const screen = await newPage(); await screen.goto(`${BASE}/#/screen/${code}`, { waitUntil: 'networkidle0' }); pages.push(screen);
  reduce(room, { playerId: room.players.find((p) => p.host).id }, { type: 'mode', mode });
  broadcast(); await sleep(500);
  await check(host, `${name}:lobby-host`); await check(pages[1], `${name}:lobby-player`); await check(screen, `${name}:lobby-screen`);
  await click(host, '[data-a="qrFull"]'); await sleep(400); await check(host, `${name}:qr`); await host.evaluate(() => document.querySelector('.qr-full')?.click()); await sleep(300);
  await step(pages, name);
  for (const p of pages) await closePage(p);
}
if (process.env.VERBOSE) console.log([...seen].join('\n'));
await finish();
