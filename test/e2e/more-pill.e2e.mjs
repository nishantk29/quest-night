// E2E (browser, Chromium): on phones Tools is a pill in the tab bar that opens Table Tools in a sheet (js/more-pill.js).
// A host phone in a real room with five scripted phones (raw WebSockets); one stays connected as the witness of server state.
// Asserts: the pill replaces only the Tools tab (44px, aria), the sheet opens by click / Enter and closes by Escape, Back,
// the scrim and Close with focus back on the pill; every tool inside it works (stepper, public and private rolls, timers);
// a running timer keeps its endsAt and keeps counting down while the sheet is closed and after it reopens; live updates
// patch the open sheet in place (same nodes, no #app child swaps, scroll kept); the sheet is opaque; the pill hides with
// the tab bar while typing; the morph uses transform + opacity only within 400ms, and nothing moves with reduced motion or
// with Animations off; at 1280 Tools stays a side tab. No page errors.
// Run: node test/e2e/more-pill.e2e.mjs   (starts wrangler dev)   or BASE=https://<host> (live; closes its room)
import { fileURLToPath } from 'node:url';
import { ledger, server, launch, phone, DEVICES } from './phones.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const L = ledger('quest more-pill e2e');
const srv = await server(ROOT);
const browser = await launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(100); } return false; };
function bot(code, name, hostKey) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`${srv.base.replace(/^http/, 'ws')}/ws/${code}`); const b = { name, ws, view: null, creds: null };
    b.send = (m) => ws.send(JSON.stringify(m));
    ws.onopen = () => b.send({ type: 'hello', join: name, hostKey });
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'joined') b.creds = { playerId: m.playerId, token: m.token }; if (m.type === 'view') b.view = m.view; if (b.creds && b.view && !b.ok) { b.ok = true; res(b); } };
    ws.onerror = () => rej(new Error(`bot ${name}`)); setTimeout(() => rej(new Error(`bot ${name} timed out`)), 30000);
  });
}
const secs = (t) => { const [m, s] = String(t).trim().split(':').map(Number); return m * 60 + s; };
const PILL = '.tabbar .more-pill'; const SHEET = '.tools-sheet';
const sheetOpen = (page) => page.evaluate((s) => { const d = document.querySelector(s); return !!d && d.getAttribute('role') === 'dialog' && d.getClientRects().length > 0; }, SHEET);
const expanded = (page) => page.locator(PILL).getAttribute('aria-expanded');
const pillFocused = (page) => page.evaluate(() => !!document.activeElement?.matches('.tabbar .more-pill'));
const marksKept = (page) => page.evaluate(() => { const m = window.__marked; return m.layout === document.querySelector('.layout') && m.tabbar === document.querySelector('.tabbar') && m.board === document.querySelector('.track') && m.board.isConnected; });
// A browser phone seated as a bot (the bot's socket is closed first, so the browser takes the seat over).
async function seatAs(b, code, opts = {}) {
  b.ws.close(); await sleep(300);
  const p = opts.ctxOpts ? await rawPhone(opts.ctxOpts, b.name) : await phone(browser, srv.base, b.name);
  await p.ctx.addInitScript(({ code, creds, hostKey, fxOff }) => {
    localStorage.setItem(`quest.player.${code}`, JSON.stringify(creds)); if (hostKey) localStorage.setItem(`quest.host.${code}`, hostKey);
    if (fxOff) localStorage.setItem('quest.fx', '0');
  }, { code, creds: b.creds, hostKey: opts.hostKey || null, fxOff: !!opts.fxOff });
  await p.goto(`/#/play/${code}`);
  await p.page.waitForSelector('.tabbar', { timeout: 30000 });
  return p;
}
// A context with motion allowed (phone() always forces reduced motion).
async function rawPhone(ctxOpts, name) {
  const ctx = await browser.newContext({ ...DEVICES.p390, serviceWorkers: 'block', ...ctxOpts });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  return { ctx, page, errors, goto: (path) => page.goto(srv.base + path, { waitUntil: 'domcontentloaded' }), close: () => ctx.close() };
}
const transformAnims = (page) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.getAnimations().filter((a) => a.effect.getKeyframes().some((k) => k.transform && k.transform !== 'none')).length : -1; }, SHEET);

let host; let room; const bots = []; const pages = [];
try {
  room = await fetch(`${srv.base}/api/create`, { method: 'POST' }).then((r) => r.json());
  const hb = await bot(room.code, 'E2E Hal', room.hostKey);
  for (const n of ['E2E Ana', 'E2E Ben', 'E2E Cal', 'E2E Dee', 'E2E Eve']) bots.push(await bot(room.code, n));
  hb.send({ type: 'start' }); await until(() => hb.view.phase === 'reveal');
  for (const b of [hb, ...bots]) b.send({ type: 'ready' }); await until(() => hb.view.phase === 'propose');
  const witness = bots[0];
  host = await seatAs(hb, room.code, { hostKey: room.hostKey }); pages.push(host);
  const P = host.page;
  await P.waitForSelector('.track', { timeout: 30000 });

  // 1. the pill
  const box = await P.locator(PILL).boundingBox();
  L.check('1 pill visible in the tab bar', await P.locator(PILL).isVisible());
  L.check('1 pill is at least 44x44 and inside the viewport', box && box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844, box);
  L.check('1 pill says Tools, aria-haspopup=dialog, aria-expanded=false', (await P.locator(PILL).innerText()).trim() === 'Tools' && (await P.locator(PILL).getAttribute('aria-haspopup')) === 'dialog' && (await expanded(P)) === 'false');
  const tabs = await P.$$eval('.tabbar [data-a="tab"]', (x) => x.map((e) => e.dataset.v));
  L.check('1 no Tools tab; Table, Chat, Log, Host tabs still there', (await P.locator('.tabbar [data-v="tools"]').count()) === 0 && tabs.join() === 'game,chat,log,host', tabs);

  // 2. mark nodes, scroll, count #app child insertions
  await P.evaluate(() => {
    window.scrollTo(0, 240);
    const app = document.getElementById('app'); window.__swaps = 0;
    new MutationObserver((ms) => { for (const m of ms) if (m.target === app) for (const n of m.addedNodes) if (!n.matches?.('.tools-sheet,.tools-scrim')) window.__swaps++; }).observe(app, { childList: true });
    window.__marked = { layout: document.querySelector('.layout'), tabbar: document.querySelector('.tabbar'), board: document.querySelector('.track') };
  });
  const y0 = await P.evaluate(() => scrollY);
  const tab0 = await P.evaluate(() => document.querySelector('.layout').dataset.tab);

  // 3. open by click
  await P.click(PILL); await sleep(150);
  L.check('3 click opens the sheet (role=dialog visible)', await sheetOpen(P));
  L.check('3 aria-expanded is true', (await expanded(P)) === 'true');
  L.check('3 focus moves into the sheet', await P.evaluate(() => !!document.activeElement?.closest('.tools-sheet')));
  const s3 = await P.evaluate(() => ({ tab: document.querySelector('.layout').dataset.tab, y: scrollY }));
  L.check('3 the pane underneath and the scroll position are unchanged', s3.tab === tab0 && Math.abs(s3.y - y0) <= 2, { tab0, y0, ...s3 });
  L.check('3 layout, tab bar and board are the same nodes', await marksKept(P));
  const op = await P.evaluate(() => { const cs = (s) => getComputedStyle(document.querySelector(s)); const bg = cs('.tools-sheet').backgroundColor; const m = bg.match(/[\d.]+/g).map(Number);
    return { bf: ['.tabbar .more-pill', '.tools-sheet', '.tools-scrim'].map((s) => cs(s).backdropFilter), alpha: m.length > 3 ? m[3] : 1 }; });
  L.check('3 opaque: no backdrop-filter on pill, sheet or scrim; sheet background alpha 1', op.bf.every((x) => x === 'none') && op.alpha === 1, op);

  // 4. every button in the sheet is a 44px target
  const small = await P.$$eval(`${SHEET} button`, (x) => x.map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim() || e.getAttribute('aria-label'), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((r) => r.w < 44 || r.h < 44));
  L.check('4 every button in the sheet is at least 44x44', small.length === 0, small);

  // 5. stepper
  await P.click(`${SHEET} [aria-label="More dice"]`); await P.click(`${SHEET} [aria-label="More dice"]`);
  const dice = await P.evaluate(() => ({ n: document.querySelector('.tools-sheet .dice-row b').textContent, roll: document.querySelector('.tools-sheet [data-a="dice"]').textContent.trim() }));
  L.check('5 stepper inside the sheet works (3 dice, Roll 3d6)', dice.n === '3' && dice.roll === 'Roll 3d6', dice);

  // 6. public roll
  await P.click(`${SHEET} [data-a="dice"]`);
  await until(() => /rolled 3d6/.test(witness.view.log.at(-1)?.text || ''), 5000);
  const last = witness.view.log.at(-1);
  L.check('6 public roll reaches the room (witness log: tool, rolled 3d6)', last?.kind === 'tool' && /rolled 3d6/.test(last.text), last);
  await sleep(300);
  const toast = await P.evaluate(() => { const t = document.getElementById('toast'); t.style.pointerEvents = 'auto'; const r = t.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); t.style.pointerEvents = ''; return { on: t.classList.contains('on'), text: t.textContent, top: top === t || t.contains(top) }; });
  L.check('6 the toast shows the roll above the sheet', toast.on && /rolled 3d6/.test(toast.text) && toast.top, toast);

  // 7. private roll
  await P.click(`${SHEET} [data-a="privDice"]`);
  const priv = await P.locator(`${SHEET} .priv-out`).innerText();
  L.check('7 private roll shows in the sheet', priv.startsWith('Private 3d6:'), priv);

  // 8. timer
  await P.click(`${SHEET} [data-a="timer"][data-v="120"]`);
  await P.waitForSelector(`${SHEET} .timer-big b[data-ends]`, { timeout: 5000 });
  const E1 = await P.getAttribute(`${SHEET} .timer-big b[data-ends]`, 'data-ends');
  await until(() => witness.view.timer?.endsAt === +E1, 5000);
  L.check('8 the timer runs on the server with the same endsAt', !!E1 && witness.view.timer?.endsAt === +E1, { E1, server: witness.view.timer?.endsAt });
  const t1 = secs(await P.innerText(`${SHEET} .timer-big b[data-ends]`)); await sleep(1200);
  const t2 = secs(await P.innerText(`${SHEET} .timer-big b[data-ends]`));
  L.check('8 the timer counts down inside the sheet', t2 <= t1 - 1, { t1, t2 });

  // 9. live updates while open
  await P.evaluate(() => { const s = document.querySelector('.tools-sheet'); s.scrollTop = 80; window.__sheet = s; window.__swaps = 0; });
  const st0 = await P.evaluate(() => document.querySelector('.tools-sheet').scrollTop);
  for (const [i, m] of [{ type: 'chat', text: 'One' }, { type: 'chat', text: 'Two' }, { type: 'coin' }, { type: 'chat', text: 'Three' }].entries()) { bots[i % 2].send(m); await sleep(250); }
  await sleep(800);
  const live = await P.evaluate(() => ({ same: window.__sheet === document.querySelector('.tools-sheet'), st: document.querySelector('.tools-sheet').scrollTop, dice: document.querySelector('.tools-sheet .dice-row b').textContent, swaps: window.__swaps }));
  L.check('9 live updates patch the open sheet in place (same node, scroll kept, dice 3, no #app swaps)', live.same && Math.abs(live.st - st0) <= 1 && st0 > 0 && live.dice === '3' && live.swaps === 0, { st0, ...live });

  // 10. Escape
  await P.keyboard.press('Escape'); await sleep(100);
  L.check('10 Escape closes the sheet, aria-expanded false', !(await sheetOpen(P)) && (await expanded(P)) === 'false');
  L.check('10 focus is back on the pill', await pillFocused(P));
  await sleep(350);
  const s10 = await P.evaluate(() => ({ ghosts: document.querySelectorAll('.more-ghost').length, y: scrollY }));
  L.check('10 no ghost left, same nodes, scroll unchanged', s10.ghosts === 0 && (await marksKept(P)) && Math.abs(s10.y - y0) <= 2, { y0, ...s10 });

  // 11. while closed the timer keeps running (app bar chip, server)
  const c1 = await P.evaluate(() => { const b = document.querySelector('.appbar .chips b[data-ends]'); return b && { ends: b.dataset.ends, t: b.textContent }; });
  await sleep(2200);
  const c2 = await P.evaluate(() => document.querySelector('.appbar .chips b[data-ends]')?.textContent);
  L.check('11 closed: the app bar chip carries the same endsAt and counts down', c1 && c1.ends === E1 && secs(c2) < secs(c1.t), { c1, c2, E1 });
  const started = witness.view.log.filter((m) => /started a 2:00 timer/.test(m.text)).length;
  L.check('11 closed: the server timer is untouched (same endsAt, one start line)', witness.view.timer?.endsAt === +E1 && started === 1, { started });

  // 12. reopen with Enter on the focused pill
  await P.keyboard.press('Enter'); await sleep(150);
  const r12 = await P.evaluate(() => { const b = document.querySelector('.tools-sheet .timer-big b[data-ends]'); return b && { ends: b.dataset.ends, t: b.textContent, dice: document.querySelector('.tools-sheet .dice-row b').textContent, priv: document.querySelector('.tools-sheet .priv-out')?.textContent }; });
  L.check('12 Enter on the pill reopens the sheet', await sheetOpen(P));
  L.check('12 reopened: same endsAt, still counting down, dice and private roll kept', r12 && r12.ends === E1 && secs(r12.t) <= t2 - 2 && secs(r12.t) > 0 && r12.dice === '3' && r12.priv === priv, { ...r12, t2 });

  // 13. stop the timer from the sheet
  await P.click(`${SHEET} [data-a="timerStop"]`);
  await until(() => witness.view.timer === null, 5000);
  await sleep(300);
  L.check('13 Stop in the sheet stops the room timer', witness.view.timer === null && (await P.locator(`${SHEET} .timer-big`).count()) === 0);

  // 14. Back
  const url = P.url();
  await P.evaluate(() => history.back()); await sleep(400);
  L.check('14 Back closes the sheet, URL unchanged, focus on the pill', !(await sheetOpen(P)) && P.url() === url && (await pillFocused(P)), P.url());
  const h0 = await P.evaluate(() => history.length);
  for (let i = 0; i < 3; i++) { await P.click(PILL); await sleep(150); await P.keyboard.press('Escape'); await sleep(200); }
  const h1 = await P.evaluate(() => history.length);
  L.check('14 three open/Escape cycles leave history.length unchanged', h1 === h0 && !(await sheetOpen(P)), { h0, h1 });

  // 15. scrim and Close
  await P.click(PILL); await sleep(150);
  await P.click('.tools-scrim', { position: { x: 195, y: 20 } }); await sleep(150);
  L.check('15 scrim tap closes, focus on the pill', !(await sheetOpen(P)) && (await pillFocused(P)));
  await P.click(PILL); await sleep(150);
  await P.click(`${SHEET} .tools-sheet-top [data-a="toolsClose"]`); await sleep(150);
  L.check('15 Close button closes, focus on the pill', !(await sheetOpen(P)) && (await pillFocused(P)));

  // other tabs still work
  await P.click('.tabbar [data-v="log"]'); await sleep(150);
  const logTab = await P.evaluate(() => document.querySelector('.layout').dataset.tab);
  await P.click('.tabbar [data-v="host"]'); await sleep(150);
  const hostTab = await P.evaluate(() => document.querySelector('.layout').dataset.tab);
  L.check('other tabs still switch panes (Log, Host)', logTab === 'log' && hostTab === 'host', { logTab, hostTab });

  // 16. keyboard up (touch context)
  await P.click('.tabbar [data-v="chat"]'); await sleep(150);
  await P.focus('#chat-in'); await sleep(150);
  const kb = await P.evaluate(() => ({ bar: getComputedStyle(document.querySelector('.tabbar')).display, pill: document.querySelector('.tabbar .more-pill').getClientRects().length }));
  await P.evaluate(() => document.activeElement.blur()); await sleep(200);
  const back = await P.locator(PILL).isVisible();
  L.check('16 while typing the tab bar and pill are hidden; blur brings them back', kb.bar === 'none' && kb.pill === 0 && back, { ...kb, back });
  await P.click('.tabbar [data-v="game"]'); await sleep(150);

  // 17. reduced motion (this phone): no transform animation, no ghost
  await P.click(PILL);
  const rm = { anims: await transformAnims(P), tf: await P.evaluate((s) => getComputedStyle(document.querySelector(s)).transform, SHEET) };
  await P.keyboard.press('Escape');
  const rmGhost = await P.locator('.more-ghost').count();
  L.check('17 reduced motion: no transform animation, transform none, no ghost', rm.anims === 0 && rm.tf === 'none' && rmGhost === 0, { ...rm, rmGhost });

  // 17. motion on (own context, a player phone): FLIP on transform + opacity, <= 400ms; close leaves a ghost for under 350ms
  const mo = await seatAs(bots[3], room.code, { ctxOpts: { reducedMotion: 'no-preference' } }); pages.push(mo);
  await mo.page.click(PILL);
  const anim = await mo.page.evaluate((s) => document.querySelector(s).getAnimations().map((a) => ({ d: a.effect.getTiming().duration, props: [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k)))].filter((p) => !['offset', 'computedOffset', 'easing', 'composite'].includes(p)), t: a.effect.getKeyframes().some((k) => k.transform && k.transform !== 'none') })), SHEET);
  L.check('17 motion on: opening runs a transform animation on transform + opacity only, <= 400ms', anim.some((a) => a.t) && anim.every((a) => a.d <= 400 && a.props.every((p) => p === 'transform' || p === 'opacity')), anim);
  L.check('17 motion on: focus moves into the sheet', await mo.page.evaluate(() => !!document.activeElement?.closest('.tools-sheet')));
  await sleep(350);
  await mo.page.keyboard.press('Escape');
  const ghostNow = await mo.page.locator('.more-ghost').count();
  await sleep(350);
  const ghostLater = await mo.page.locator('.more-ghost').count();
  L.check('17 motion on: closing shrinks a ghost back into the pill, gone within 350ms; focus on the pill', ghostNow === 1 && ghostLater === 0 && (await pillFocused(mo.page)), { ghostNow, ghostLater });
  await mo.close();

  // 17. Animations off (motion allowed by the OS, switch off on this device): nothing moves
  const off = await seatAs(bots[3], room.code, { ctxOpts: { reducedMotion: 'no-preference' }, fxOff: true }); pages.push(off);
  const fxOff = await off.page.evaluate(() => document.documentElement.classList.contains('fx-off'));
  await off.page.click(PILL);
  const offR = { anims: await transformAnims(off.page), focus: await off.page.evaluate(() => !!document.activeElement?.closest('.tools-sheet')) };
  await off.page.keyboard.press('Escape');
  const offG = await off.page.locator('.more-ghost').count();
  L.check('17 Animations off: no transform animation, no ghost, focus still moves', fxOff && offR.anims === 0 && offG === 0 && offR.focus && (await pillFocused(off.page)), { fxOff, ...offR, offG });
  await off.close();

  // 18. 1280 wide
  await P.click(PILL); await sleep(100);
  await P.setViewportSize({ width: 1280, height: 800 }); await sleep(400);
  const wide = await P.evaluate(() => ({ bar: getComputedStyle(document.querySelector('.tabbar')).display, sheet: document.querySelectorAll('.tools-sheet').length,
    side: document.querySelector('[data-a="side"][aria-selected="true"]')?.dataset.v, dice: document.querySelector('.col-side .dice-row b')?.textContent, inert: !!document.querySelector('.layout[inert]') }));
  L.check('18 open at 390 then 1280: sheet gone, side tab Tools selected, dice still 3, nothing inert', wide.sheet === 0 && wide.side === 'tools' && wide.dice === '3' && !wide.inert, wide);
  L.check('18 1280: tab bar and pill hidden', wide.bar === 'none' && !(await P.locator(PILL).isVisible()));
  await P.click('.col-side [aria-label="More dice"]'); await sleep(150);
  L.check('18 1280: the side tab stepper works', (await P.innerText('.col-side .dice-row b')) === '4');
  await P.setViewportSize({ width: 390, height: 844 }); await sleep(300);

  // 19. a player phone: the read-only timer ticks in the sheet
  await P.click(PILL); await P.click(`${SHEET} [data-a="timer"][data-v="60"]`); await P.keyboard.press('Escape');
  await until(() => !!witness.view.timer?.endsAt, 5000);
  const pl = await seatAs(bots[4], room.code); pages.push(pl);
  await pl.page.click(PILL); await sleep(150);
  const pv = await pl.page.evaluate(() => ({ open: !!document.querySelector('.tools-sheet'), stop: document.querySelectorAll('.tools-sheet [data-a="timerStop"]').length, t: document.querySelector('.tools-sheet .timer-big b[data-ends]')?.textContent }));
  await sleep(1300);
  const pt = await pl.page.evaluate(() => document.querySelector('.tools-sheet .timer-big b[data-ends]')?.textContent);
  L.check('19 player: the pill opens the sheet, the read-only timer (no Stop) ticks', pv.open && pv.stop === 0 && pv.t && secs(pt) < secs(pv.t), { ...pv, pt });

  const errs = pages.flatMap((p) => p.errors);
  L.check('no page errors on any phone', errs.length === 0, errs.slice(0, 3));
} catch (e) {
  L.check('run finished without throwing', false, String(e.message || e).split('\n')[0]);
} finally {
  try { if (room) { const c = host && (await host.page.evaluate((k) => localStorage.getItem(k), `quest.player.${room.code}`).catch(() => null)); const h = new WebSocket(`${srv.base.replace(/^http/, 'ws')}/ws/${room.code}`); await new Promise((r) => { h.onopen = () => { h.send(JSON.stringify({ type: 'hello', ...JSON.parse(c || '{}') })); setTimeout(() => { h.send(JSON.stringify({ type: 'close' })); setTimeout(r, 800); }, 800); }; setTimeout(r, 5000); }); } } catch { /* the room expires on its own */ }
  for (const b of bots) { try { b.ws.close(); } catch { /* gone */ } }
  await browser.close(); srv.stop();
  L.done();
}
