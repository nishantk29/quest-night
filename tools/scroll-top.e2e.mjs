// Scroll-to-top e2e (Nishant 2026-10-28: "The player hands dont open to the card. People have to scroll up.
// Keep the card hidden just open to the top."). Static files come from the repo's public/ dir, and the room
// WebSocket is answered in-process by the repo's own room.js, so no dev server is needed.
// usage: node scroll-top.mjs <repoDir> <gilded|quest>   exit 0 = pass, 1 = fail
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const require = createRequire('/workspace/forge/pw/');
const { chromium, webkit } = require('playwright-core');
const [repo, game] = process.argv.slice(2);
const pub = path.join(repo, 'public');
const R = await import(path.join(repo, 'public/js/room.js'));
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp' };
const CFG = {
  gilded: { name: '[data-i="joinName"]', seat: '[data-a="join"]', card: '.rcard-tap', code: 'TESTAB' },
  quest: { name: '[data-i="joinName"]', seat: '[data-a="join"]', card: '.rcard-tap', code: 'TESTAB' },
}[game];
const serveFile = (route) => {
  const u = new URL(route.request().url());
  if (u.pathname.startsWith('/api/room/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"exists":true}' });
  const f = path.join(pub, u.pathname === '/' ? '/index.html' : u.pathname);
  if (!f.startsWith(pub) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
  return route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f), headers: { 'cache-control': 'no-store' } });
};
function fakeRoomSocket(room) {
  const sockets = [];
  const plan = R.broadcastPlan || ((rm, socks, conn) => socks.filter((s) => s.who).map((s) => ({ ws: s.ws, msgs: [{ type: 'view', view: s.playerId ? R.viewForPlayer(rm, s.playerId, conn) : R.viewForScreen(rm, conn) }] })));
  const broadcast = () => { for (const { ws, msgs } of plan(room, sockets, new Set(sockets.map((s) => s.playerId)))) for (const m of msgs) ws.send(JSON.stringify(m)); };
  const onSocket = (ws) => {
    const s = { ws, who: null, playerId: null }; sockets.push(s);
    ws.onMessage((raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'hello') {
        if (msg.playerId) { s.who = 'player'; s.playerId = msg.playerId; }
        else if (msg.join) {
          const r = R.reduce(room, { anon: true }, { type: 'join', name: msg.join });
          if (r.error) return ws.send(JSON.stringify({ type: 'error', error: r.error }));
          s.who = 'player'; s.playerId = r.data.playerId; ws.send(JSON.stringify({ type: 'joined', ...r.data }));
        } else return ws.send(JSON.stringify({ type: 'lobby', phase: room.phase, count: room.players.length }));
        return broadcast();
      }
      if (!s.playerId) return;
      const r = R.reduce(room, { playerId: s.playerId }, msg);
      if (r.error) return ws.send(JSON.stringify({ type: 'error', error: r.error }));
      broadcast();
    });
  };
  return { onSocket, broadcast };
}
async function run(browserType, device, label) {
  const room = R.newRoom(CFG.code, 'hk');
  const bots = ['Host', 'Bo', 'Cy', 'Di'].map((name, i) => R.reduce(room, {}, { type: 'join', name, hostKey: i ? undefined : 'hk' }).data.playerId);
  const fake = fakeRoomSocket(room);
  const browser = await browserType.launch(browserType === chromium ? { executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] } : {});
  const ctx = await browser.newContext(device);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/*', serveFile);
  await page.routeWebSocket(/\/ws\//, fake.onSocket);
  await page.goto(`http://game.test/#/play/${CFG.code}`);
  await page.fill(CFG.name, 'Eve'); await page.click(CFG.seat);
  await page.waitForFunction(() => document.documentElement.dataset.phase === 'lobby');
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); // a player reading the seat list
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => window.scrollY);
  const res = R.reduce(room, { playerId: bots[0] }, { type: 'start' }); if (res.error) throw new Error(res.error);
  fake.broadcast();
  await page.waitForFunction(() => document.documentElement.dataset.phase === 'reveal');
  await page.waitForTimeout(1500); // the screen transition and any late layout
  const out = await page.evaluate((sel) => {
    const el = document.querySelector(sel); const r = el?.getBoundingClientRect();
    const dock = [...document.querySelectorAll('.sticky-act, .tabbar, nav, .dock')].map((d) => d.getBoundingClientRect()).filter((b) => b.height && b.top > window.innerHeight / 2).map((b) => b.top);
    const dockTop = Math.round(Math.min(window.innerHeight, ...dock));
    return { dockTop, y: Math.round(window.scrollY), h: window.innerHeight, found: !!el, top: r && Math.round(r.top), bottom: r && Math.round(r.bottom), hidden: !!el && (el.classList.contains('is-hidden') || !!el.querySelector('.is-hidden')) };
  }, CFG.card);
  await page.screenshot({ path: `/workspace/forge/e2e/${game}-${label.split(' ')[0]}.png` });
  await browser.close();
  const pass = out.found && out.y === 0 && out.top >= 0 && out.bottom <= out.dockTop && out.hidden;
  console.log(JSON.stringify({ label, pass, scrolledBefore: before, ...out, errs: errs.slice(0, 3) }));
  return pass;
}
const iPhone = { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
const android = { viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' };
const a = process.env.NO_WEBKIT ? (console.log('webkit skipped (NO_WEBKIT)'), true) : await run(webkit, iPhone, 'webkit iPhone 320x568');
const a2 = await run(chromium, iPhone, 'chromium iPhone-size 320x568');
const b = await run(chromium, android, 'chromium Android 360x640');
process.exit(a && a2 && b ? 0 : 1);
