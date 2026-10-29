// E2E (browser, Chromium): Back (page.goBack(), as Android Back or the iOS edge swipe) closes the open sheet first.
// Covers: the host's Roles sheet in the lobby and a player's Roles sheet in the game; a sheet closed by a tap leaves no
// extra entry (one Back leaves); Back is never trapped (the next Back leaves); Escape still works; the deal still runs.
// Run: node test/e2e/back-nav.e2e.mjs   (starts wrangler dev)   |   BASE=https://<live host> node test/e2e/back-nav.e2e.mjs
import { fileURLToPath } from 'node:url';
import { ledger, server, launch, phone, checkPhones } from './phones.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const L = ledger('quest back-nav e2e');
const srv = await server(ROOT);
const browser = await launch();
const all = [];
const layer = (p) => p.page.evaluate(() => document.querySelectorAll('dialog[open]').length);
const hash = (p) => p.page.evaluate(() => location.hash);
const back = async (p) => { await p.page.goBack({ timeout: 5000 }).catch(() => {}); await p.page.waitForTimeout(500); };
const fwd = async (p) => { await p.page.goForward({ timeout: 5000 }).catch(() => {}); await p.page.waitForTimeout(2000); };
const roles = (p) => p.page.locator('[data-a="roles"]:visible').first().click({ timeout: 8000 });
try {
  const host = await phone(browser, srv.base, 'host'); all.push(host);
  await host.goto('/#/');
  await host.page.locator('[data-i="hostName"]').fill('E2E Ana');
  await host.page.locator('[data-a="host"]').click();
  await host.page.waitForFunction(() => /#\/play\/[A-Z]{6}/.test(location.hash), null, { timeout: 15000 });
  const room = await hash(host); const code = room.match(/[A-Z]{6}/)[0];
  await host.page.waitForTimeout(1000);
  await roles(host);
  L.check('host: Roles in this game opens in the lobby', (await layer(host)) === 1);
  await back(host);
  L.check('host: Back closes it and stays in the room', (await layer(host)) === 0 && (await hash(host)) === room, await hash(host));
  await roles(host);
  await host.page.mouse.click(195, 20); await host.page.waitForTimeout(400);
  L.check('host: a tap outside the sheet closes it', (await layer(host)) === 0);
  await back(host);
  L.check('host: after a tap-close, one Back leaves the room (no leftover entry)', (await hash(host)) === '#/', await hash(host));
  await fwd(host);
  L.check('host: Forward brings the room back', (await hash(host)) === room);
  await roles(host);
  await back(host); await back(host);
  L.check('host: Back closes the sheet, the next Back leaves (never trapped)', (await layer(host)) === 0 && (await hash(host)) === '#/', await hash(host));
  await fwd(host);

  const players = [];
  for (const n of ['E2E Ben', 'E2E Cal', 'E2E Dee', 'E2E Eve']) {
    const p = await phone(browser, srv.base, n); all.push(p); players.push(p);
    await p.goto('/#/'); await p.goto('/#/play/' + code);
    const input = p.page.locator('[data-i="joinName"]'); await input.waitFor({ timeout: 10000 });
    for (let i = 0; i < 3 && (await input.count()); i++) { await input.fill(n).catch(() => {}); await p.page.locator('[data-a="join"]').click({ timeout: 3000 }).catch(() => {}); await input.waitFor({ state: 'detached', timeout: 4000 }).catch(() => {}); }
  }
  await host.page.waitForFunction(() => document.body.innerText.includes('E2E Eve'), null, { timeout: 15000 }).catch(() => {});
  for (let i = 1; i <= 3; i++) { await host.page.locator('.cs-btn').click({ timeout: 10000 }); await host.page.waitForSelector(`.cs[data-step="${i}"]`, { timeout: 5000 }); }
  await host.page.locator('[data-a="csDeal"]').click({ timeout: 10000 });
  for (const p of all) await p.page.locator('[data-a="rolesSeen"]').click({ timeout: 15000 }).catch(() => {});
  for (const p of all) await p.page.locator('.rcard-tap').first().waitFor({ timeout: 15000 }).catch(() => {});
  L.check('the deal still reaches every phone', (await Promise.all(all.map((p) => p.page.locator('.rcard-tap').count()))).every((n) => n > 0));
  const ben = players[0];
  await roles(ben);
  L.check('player: Roles in this game opens in the game', (await layer(ben)) === 1);
  await back(ben);
  L.check('player: Back closes it and keeps the role card on screen', (await layer(ben)) === 0 && (await hash(ben)) === '#/play/' + code && (await ben.page.locator('.rcard-tap').count()) > 0);
  await roles(ben); await ben.page.keyboard.press('Escape'); await ben.page.waitForTimeout(300);
  L.check('player: Escape still closes it', (await layer(ben)) === 0);
  await back(ben);
  L.check('player: then one Back leaves the room', (await hash(ben)) === '#/', await hash(ben));
  await checkPhones(L, all, 'after Backs');
} catch (e) {
  L.check('suite ran to the end', false, String(e && e.message || e).split('\n')[0]);
} finally {
  await browser.close(); srv.stop(); L.done();
}
