// Animation + stability audit: `node tools/anim-check.mjs` (exit 1 on any failure). Same in-process room and iPhone-sized touch
// emulation as drift-check.mjs. Records a rAF rect trace of every animated element and its container, counts animationstart
// events across forced same-state re-renders, and checks nothing keeps running after 700 ms (and nothing runs at all under
// reduced motion or with the Animations switch off).
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

// ---- watchdog: hard cap on the whole run; summary is printed from whatever finished
const T0 = Date.now(); const HARD = 150000;
const pad = (v, n) => String(v).padEnd(n);
const W = [16, 14, 7, 12, 12, 13, 12, 7, 5];
async function finish(code, note) {
  if (note) fails.push(note);
  console.log(`anim-check: ${rows.length} rows, ${fails.length} failure(s)`);
  for (const f of fails) console.log(' ✗ ' + f);
  try { await Promise.race([browser.close(), sleep(3000)]); } catch {}
  try { server.close(); } catch {}
  process.exit(fails.length ? 1 : code);
}
setTimeout(() => finish(1, `hard timeout ${HARD / 1000}s hit`), HARD).unref();
// ---- browser
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 8000, args: ['--no-sandbox', '--disable-features=OverscrollHistoryNavigation'] });
const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function newPage() {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
  page.setDefaultTimeout(6000); page.on('pageerror', (e) => console.error('pageerror', e.message)); page.on('console', (m) => m.type() === 'error' && console.error('console', m.text()));
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

const closePage = async (p) => { for (const s of [...socks]) if (s.page === p) socks.delete(s); await p.browserContext().close(); };
const click = (page, sel) => page.evaluate((s) => { document.activeElement?.blur?.(); const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);
const setName = async (page, sel, v) => { await page.waitForSelector(sel, { timeout: 6000 }).catch(async (e) => { console.error(page.url(), (await page.evaluate(() => document.body.innerText)).slice(0, 300)); throw e; }); await page.click(sel, { clickCount: 3 }); await page.type(sel, v); };

// ---- in-page recorder: per-frame rect of each animated element and its container, plus every animationstart
const WATCH = {
  home: ['.path', '.home-paths'], sheet: ['dialog.confirm-sheet', 'main'], reveal: ['.rcard-face', '.hand'],
  step: ['.stage', '.appbar'], flip: ['.qcards .flip', '.qcards'], tiles: ['.vtile', '.vtiles'], victory: ['.vc-wrap', '.fx-victory'], seal: ['.seal.is-pop', '.seals'],
};
const recorder = (watch) => {
  window.__as = []; window.__rec = {}; for (const k in watch) window.__rec[k] = [];
  document.addEventListener('animationstart', (e) => window.__as.push({ n: e.animationName, t: performance.now() }), true);
  const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
  const tick = (t) => {
    for (const [k, [s, c]] of Object.entries(watch)) { const a = box(document.querySelector(s)); if (a && window.__rec[k].length < 900) window.__rec[k].push({ t, a, c: box(document.querySelector(c)) }); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const mkPage = async (variant) => {
  const page = await newPage();
  if (variant === 'reduced') await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  if (variant === 'off') await page.evaluateOnNewDocument(() => localStorage.setItem('quest.fx', '0'));
  await page.evaluateOnNewDocument(recorder, WATCH);
  return page;
};
const running = (page) => page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').map((a) => (a.animationName || a.transitionProperty || a.constructor.name) + '@' + (a.effect?.target?.className?.toString?.().slice(0, 30) || a.effect?.target?.tagName)));
const starts = (page) => page.evaluate(() => window.__as.map((x) => x.n));
const resetRec = (page) => page.evaluate(() => { for (const k in window.__rec) window.__rec[k].length = 0; window.__as.length = 0; });

const has = (p, sel) => p.$(sel).catch(() => null);
console.log(['run', 'element', 'frames', 'max step px', 'max size px', 'container px', 'running@700', 'starts', ''].map((h, i) => pad(h, W[i])).join(''));
const fails = [];
const rows = { push(r) { this.length = (this.length || 0) + 1; console.log(r.map((v, i) => pad(v, W[i])).join('')); } };
function analyse(name, frames) {
  let step = 0; let size = 0; let cont = 0; const c0 = frames[0]?.c;
  for (let i = 0; i < frames.length; i++) {
    if (c0 && frames[i].c) cont = Math.max(cont, ...frames[i].c.map((v, j) => Math.abs(v - c0[j])));
    if (i) { const a = frames[i - 1].a; const b = frames[i].a;
      step = Math.max(step, Math.hypot((b[0] + b[2] / 2) - (a[0] + a[2] / 2), (b[1] + b[3] / 2) - (a[1] + a[3] / 2))); size = Math.max(size, Math.abs(b[2] - a[2]), Math.abs(b[3] - a[3])); }
  }
  return { frames: frames.length, step: +step.toFixed(1), size: +size.toFixed(1), cont: +cont.toFixed(1) };
}
async function report(page, label, key, { after = 700, expectStarts, containerStable = true, teleport = true } = {}) {
  await sleep(after);
  const frames = await page.evaluate((k) => window.__rec[k].slice(), key);
  const run = await running(page); const st = await starts(page);
  const m = frames.length ? analyse(key, frames) : { frames: 0, step: 0, size: 0, cont: 0 };
  const why = [];
  if (!m.frames) why.push('element never seen');
  if (teleport && (m.step > 40 || m.size > 40)) why.push(`teleport ${m.step}/${m.size}px in one frame`);
  if (containerStable && m.cont > 0.5) why.push(`container moved ${m.cont}px`);
  if (run.length) why.push(`still running: ${run.slice(0, 3)}`);
  if (expectStarts && !expectStarts(st)) why.push(`animationstart: ${st.join(',') || 'none'}`);
  rows.push([label, key, m.frames, m.step, m.size, m.cont, run.length, st.length, why.length ? 'FAIL' : 'ok']);
  if (why.length) fails.push(`${label}/${key}: ${why.join('; ')}`);
}
async function noReplay(page, label, names) { // same view re-broadcast twice: re-render, never a new animation
  await sleep(900); await resetRec(page); broadcast(); await sleep(150); broadcast(); await sleep(700);
  const st = (await starts(page)).filter((n) => !names || names.includes(n));
  rows.push([label, 're-render x2', '-', '-', '-', '-', (await running(page)).length, st.length, st.length ? 'FAIL' : 'ok']);
  if (st.length) fails.push(`${label}: animation replayed on re-render: ${st.join(',')}`);
}

// ---- home
{
  const p = await mkPage(); await p.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  fs.mkdirSync('/workspace/code-team/screens/pm5', { recursive: true });
  await sleep(600); await p.screenshot({ path: '/workspace/code-team/screens/pm5/avalon-home-after-local.png' });
  await resetRec(p); await sleep(800);
  const y0 = await p.evaluate(() => document.querySelector('.home-art').getBoundingClientRect().top + scrollY);
  await p.evaluate(() => scrollTo(0, 500)); await sleep(500); await resetRec(p); await sleep(300);
  const y1 = await p.evaluate(() => document.querySelector('.home-art').getBoundingClientRect().top + scrollY);
  if (Math.abs(y1 - y0) > 0.5) fails.push(`home: .home-art moved with scroll (${y0} -> ${y1})`);
  await report(p, 'home+scroll', 'home', { after: 0, expectStarts: (s) => s.length === 0 });
  const sw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); if (sw[0] > sw[1]) fails.push(`home scrollWidth ${sw}`);
  if (await has(p, '.how .dots, .dots')) fails.push('home: carousel dots still present');
  if ((await p.$$('.how li')).length !== 4 || !(await has(p, '.hub-link'))) fails.push('home: expected 4 static steps and the All Games link');
  await closePage(p);
}

// ---- a full phones-mode game: sheet, role reveal, step change, quest-card flip, vote tiles, victory
const RUNLIST = (process.env.RUNS ?? ',reduced,off').split(',');
async function game(variant) {
  room.phase = 'lobby'; room.game = null; room.players.length = 0; room.log = []; room.undo = []; room.mode = { ...room.mode };
  const L = variant || 'normal'; const off = !!variant;
  const pages = [await mkPage(variant)]; const host = pages[0];
  await host.goto(BASE, { waitUntil: 'networkidle0' });
  await setName(host, '[data-i="hostName"]', 'Host'); await click(host, '[data-a="host"]'); await sleep(800);
  await sleep(800); if (await host.$('[data-a="join"]')) await click(host, '[data-a="join"]'); await sleep(500);
  for (let i = 1; i < 6; i++) { const p = await mkPage(variant); await p.goto(`${BASE}/#/play/${CODE}`, { waitUntil: 'networkidle0' }); await setName(p, '[data-i="joinName"]', `Player${i}`); await click(p, '[data-a="join"]'); pages.push(p); await sleep(200); }
  reduce(room, { playerId: room.players.find((p) => p.host).id }, { type: 'mode', mode: { play: 'phone' } }); broadcast(); await sleep(600);
  const seen = new Set(); const all = () => Promise.all(pages.map((p) => running(p)));
  // sheet open/close (lobby)
  if (!off) {
    await resetRec(host);
    await host.evaluate(() => import('/js/table_ui.js').then((m) => { window.__ask = m.askConfirm('Open this seat?'); }));
    await report(host, L, 'sheet', { after: 750, expectStarts: (s) => s.includes('sheet-up') });
    await host.evaluate(() => document.querySelector('dialog.confirm-sheet [data-a="confirmNo"]').click()); await sleep(200);
    if (await host.$('dialog.confirm-sheet')) fails.push(`${L}: sheet did not close`);
    await resetRec(host);
  } else {
    await host.evaluate(() => import('/js/table_ui.js').then((m) => { m.askConfirm('Open this seat?'); })); await sleep(700);
    const r = await running(host); rows.push([L, 'sheet', '-', '-', '-', '-', r.length, (await starts(host)).length, r.length ? 'FAIL' : 'ok']); if (r.length) fails.push(`${L}: sheet animates: ${r}`);
    await host.evaluate(() => document.querySelector('dialog.confirm-sheet [data-a="confirmNo"]').click()); await sleep(100);
  }
  // host-console step change: lobby -> first game screen
  await resetRec(host); await click(host, '[data-a="start"]'); await sleep(900);
  if (!off) { if (process.env.VERBOSE) console.error('step starts', await starts(host), JSON.stringify((await host.evaluate(() => window.__rec.step)).slice(0, 6))); await report(host, L, 'step', { after: 0, teleport: false }); } // old+new stage coexist during the cross-fade, so first-match rect swaps
  else { const r = await running(host); rows.push([L, 'step', '-', '-', '-', '-', r.length, (await starts(host)).length, r.length ? 'FAIL' : 'ok']); if (r.length) fails.push(`${L}: step change animates: ${r}`); }
  // drive: ready buttons etc.; at each milestone run its checks once
  const done = {};
  for (let n = 0; n < 900 && !(done.victory || (done.reveal && (done.flip || off))) && Date.now() - T0 < 40000 * (RUNLIST.indexOf(variant ?? '') + 1); n++) {
    if (process.env.VERBOSE && n % 20 === 0) console.error(L, 'loop', n, JSON.stringify(done), await pages[1].evaluate(() => document.body.innerText.slice(0, 160).replace(/\n/g, ' | ')).catch(() => 'reloading'));
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      try {
      if (!done.reveal && i === 1 && await has(p, '.rcard-tap')) {
        done.reveal = true; await sleep(300); await resetRec(p);
        await p.evaluate(() => { const b = document.querySelector('.rcard-tap'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'touch' })); });
        await sleep(150); broadcast(); await sleep(150); broadcast(); await sleep(150);
        if (!await has(p, '.rcard.is-shown')) fails.push(`${L}: hold did not reveal the card`);
        await sleep(450);
        const st = await starts(p); const un = st.filter((x) => x === 'qn-unveil').length;
        if (!off) { await report(p, L, 'reveal', { after: 0, expectStarts: () => un === 1 }); if (un !== 1) fails.push(`${L}: unveil animations during one hold: ${un}`); }
        else { const r = await running(p); rows.push([L, 'reveal', '-', '-', '-', '-', r.length, st.length, r.length || st.length ? 'FAIL' : 'ok']); if (r.length || st.length) fails.push(`${L}: reveal animates ${st}`); }
        await p.evaluate(() => document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))); await sleep(300);
      }
      if (!done.flip && await has(p, '.qcards .flip') && !off) { done.flip = true;
        await report(p, L, 'flip', { after: 750, expectStarts: (s) => s.includes('qc-pop') }); await noReplay(p, `${L} flip`); }
      if (!done.tiles && await has(p, '.vtile') && !off) { done.tiles = true;
        await report(p, L, 'tiles', { after: 750, teleport: false }); await noReplay(p, `${L} tiles`); } // rotateY flip: projected rect width swings by design, so only the container is held still
      if (!done.seal && await has(p, '.seal.is-pop') && !off) { done.seal = true; await report(p, L, 'seal', { after: 750 }); }
      if (await has(p, '.vc-wrap') && !done.victory) { done.victory = true; await sleep(750); const r = await running(p); rows.push([L, 'victory', '-', '-', '-', '-', r.length, (await starts(p)).length, !off && !r.length || off && !r.length ? 'ok' : 'FAIL']); if (r.length) fails.push(`${L}: victory still running: ${r}`); }
      if (off) { const r = await running(p); const st = await starts(p); if (r.length || st.length) { fails.push(`${L}: animation under ${L} on page ${i}: ${[...r, ...st].slice(0, 4)}`); await resetRec(p); } }
      const hit = await p.evaluate((src) => { const re = new RegExp(src); const v = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const bs = [...document.querySelectorAll('[data-a]')].filter((b) => v(b) && !b.disabled && !b.classList.contains('disabled') && b.getAttribute('aria-disabled') !== 'true' && re.test(b.dataset.a));
        const b = bs.find((x) => /^(start|propose|ready|skipReveal)$/.test(x.dataset.a)) || bs[Math.floor(Math.random() * bs.length)]; if (b) b.click(); return !!b; }, GO.source);
      await sleep(40); await p.evaluate(() => document.querySelector('dialog.confirm-sheet [data-a="confirmYes"]')?.click());
      } catch (e) { if (!/context was destroyed|Target closed|detached/.test(e.message)) throw e; await sleep(300); }
    }
    await sleep(120);
  }
  if (!done.reveal) fails.push(`${L}: never reached the role reveal`);
  for (const p of pages) await closePage(p);
}
for (const v of RUNLIST) { await game(v || undefined).catch((e) => fails.push(`${v || 'normal'}: ${e.message.slice(0, 120)}`)); if (process.env.VERBOSE) console.error('done', v || 'normal', rows.length, fails); }
await finish(0);
