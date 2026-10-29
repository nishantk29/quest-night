// E2E (browser, Chromium): a host phone and four player phones in a real room, on the shared harness (phones.mjs).
// Covers: host makes a room and takes a seat, four joins, start, every phone gets its secret role card, a player phone
// drops off and comes back (seat and role kept), and no console errors or sideways scroll on any phone at 390 px.
// Run: node test/e2e/multi-phone.e2e.mjs            (starts wrangler dev from this repo, real workerd + local DO)
//      BASE=https://<live host> node test/e2e/multi-phone.e2e.mjs   (live smoke; the test room expires on its own TTL)
// Shots: SHOTS=<dir>. Exit 1 on any failure.
import { fileURLToPath } from 'node:url';
import { ledger, server, launch, phone, dropAndWake, checkPhones } from './phones.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const NAMES = ['E2E Ben', 'E2E Cal', 'E2E Dee', 'E2E Eve'];
const L = ledger('quest multi-phone e2e');
const srv = await server(ROOT);
const browser = await launch();
const all = [];
try {
  // Host makes a room from the home screen and takes the first seat.
  const host = await phone(browser, srv.base, 'host'); all.push(host);
  await host.goto('/#/');
  await host.page.locator('[data-i="hostName"]').fill('E2E Ana');
  await host.page.locator('[data-a="host"]').click();
  await host.page.waitForFunction(() => /#\/play\/[A-Z]{6}/.test(location.hash), null, { timeout: 15000 });
  const code = await host.page.evaluate(() => location.hash.match(/[A-Z]{6}/)[0]);
  L.check('host made a room with a 6-letter code', /^[A-Z]{6}$/.test(code), code);

  // Four players join on their own phones (five seats: the minimum).
  const players = [];
  for (const n of NAMES) {
    const p = await phone(browser, srv.base, n); all.push(p); players.push(p);
    await p.goto('/#/play/' + code);
    // The join form renders before the room socket is open, and a name sent then is not taken (Mafia's live run lost all
    // five), so wait for the form and retry until it is gone.
    const input = p.page.locator('[data-i="joinName"]');
    await input.waitFor({ timeout: 10000 });
    for (let i = 0; i < 3 && (await input.count()); i++) {
      await input.fill(n).catch(() => {}); await p.page.locator('[data-a="join"]').click({ timeout: 3000 }).catch(() => {});
      await input.waitFor({ state: 'detached', timeout: 4000 }).catch(() => {});
    }
  }
  await host.page.waitForFunction((ns) => ns.every((n) => document.body.innerText.includes(n)), NAMES, { timeout: 15000 }).catch(() => {});
  const seen = await host.page.evaluate((ns) => ns.filter((n) => document.body.innerText.includes(n)).length, NAMES);
  L.check('host sees all four players in the lobby', seen === 4, `${seen}/4`);
  if (SHOTS) await host.shot(SHOTS, 'quest-host-lobby');
  await checkPhones(L, all, 'lobby');

  // Start: every seat gets its secret role card.
  // Setup is a 4-step carousel (Players, Preset, Seating, Deal): Next three times, then Deal N roles.
  for (let i = 1; i <= 3; i++) { await host.page.locator('.cs-btn').click({ timeout: 10000 }); await host.page.waitForSelector(`.cs[data-step="${i}"]`, { timeout: 5000 }); }
  await host.page.locator('[data-a="csDeal"]').click({ timeout: 10000 });
  // Every phone first sees "Roles in this game", then taps See my role.
  for (const p of all) await p.page.locator('[data-a="rolesSeen"]').click({ timeout: 15000 }).catch(() => {});
  for (const p of all) await p.page.locator('.rcard-tap').first().waitFor({ timeout: 15000 }).catch(() => {});
  const cards = await Promise.all(all.map((p) => p.page.locator('.rcard-tap').count()));
  L.check('every phone shows its role card after the start', cards.every((n) => n > 0), cards.join(','));
  if (SHOTS) { await host.shot(SHOTS, 'quest-host-started'); await players[0].shot(SHOTS, 'quest-player-role'); }
  await checkPhones(L, all, 'started');

  // A player phone loses the room for 12 s, then comes back.
  const ms = await dropAndWake(players[1], '.banner', { downMs: 12000, kind: 'online' });
  // Without the wake reconnect the backoff alone can take up to 10 s (8 s cap, ±25% jitter), so allow 12 s here.
  L.check('a dropped phone is back within 12 s of coming online', ms >= 0 && ms < 12000, `${ms} ms`);
  await players[1].page.locator('.rcard-tap').first().waitFor({ timeout: 5000 }).catch(() => {});
  L.check('it keeps its seat and its role card', (await players[1].page.locator('.rcard-tap').count()) > 0, (await players[1].text()).slice(0, 60));
  L.check('no other phone was disturbed', (await Promise.all(all.filter((p) => p !== players[1]).map((p) => p.page.locator('.banner').count()))).every((n) => n === 0));
  await checkPhones(L, all, 'after reconnect');
} catch (e) {
  L.check('suite ran to the end', false, String(e && e.message || e).split('\n')[0]);
} finally {
  await browser.close(); srv.stop(); L.done();
}
