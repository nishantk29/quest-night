// E2E (browser, Chromium): Undo and Redo on five phones in a real room (wrangler dev, real workerd + local DO).
// Covers: the host's Undo names the step; every phone follows; players get "The host went back a step"; Redo shows
// only when there is something to redo and brings the step back; five rejected parties end the game; Undo from the
// end screen asks first, hides the roles again on every phone, and Redo ends it again. No console errors.
// Run: node test/e2e/undo.e2e.mjs   Shots: SHOTS=<dir>. Exit 1 on any failure.
import { fileURLToPath } from 'node:url';
import { ledger, server, launch, phone, checkPhones } from './phones.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const NAMES = ['E2E Ben', 'E2E Cal', 'E2E Dee', 'E2E Eve'];
const L = ledger('quest undo e2e');
const srv = await server(ROOT);
const browser = await launch();
const all = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toastOf = (p) => p.page.evaluate(() => document.getElementById('toast')?.textContent || '');
const phaseOf = (p) => p.page.evaluate(() => document.querySelector('.phase-badge .pb-t')?.textContent || '');
try {
  const host = await phone(browser, srv.base, 'host'); all.push(host);
  await host.goto('/#/');
  await host.page.locator('[data-i="hostName"]').fill('E2E Ana');
  await host.page.locator('[data-a="host"]').click();
  await host.page.waitForFunction(() => /#\/play\/[A-Z]{6}/.test(location.hash), null, { timeout: 15000 });
  const code = await host.page.evaluate(() => location.hash.match(/[A-Z]{6}/)[0]);
  const players = [];
  for (const n of NAMES) {
    const p = await phone(browser, srv.base, n); all.push(p); players.push(p);
    await p.goto('/#/play/' + code);
    const input = p.page.locator('[data-i="joinName"]');
    await input.waitFor({ timeout: 10000 });
    for (let i = 0; i < 3 && (await input.count()); i++) {
      await input.fill(n).catch(() => {}); await p.page.locator('[data-a="join"]').click({ timeout: 3000 }).catch(() => {});
      await input.waitFor({ state: 'detached', timeout: 4000 }).catch(() => {});
    }
  }
  await host.page.waitForFunction((ns) => ns.every((n) => document.body.innerText.includes(n)), NAMES, { timeout: 15000 }).catch(() => {});
  for (let i = 1; i <= 3; i++) { await host.page.locator('.cs-btn').click({ timeout: 10000 }); await host.page.waitForSelector(`.cs[data-step="${i}"]`, { timeout: 5000 }); }
  await host.page.locator('[data-a="csDeal"]').click({ timeout: 10000 });
  for (const p of all) await p.page.locator('[data-a="rolesSeen"]').click({ timeout: 15000 }).catch(() => {});

  // The host starts the first quest from the Host tab, then passes the crown: two steps.
  const hostTab = async () => { await host.page.locator('[data-a="tab"][data-v="host"]').click(); await host.page.locator('[data-a="undo"]').waitFor({ timeout: 5000 }); };
  await hostTab();
  await host.page.locator('[data-a="skipReveal"]').first().click({ timeout: 10000 });
  await host.page.waitForFunction(() => document.querySelector('[data-a="undo"]')?.getAttribute('title') === 'Undo: Skipping the reveal', null, { timeout: 8000 }).catch(() => {});
  L.check('Undo names the step: “Undo: Skipping the reveal”', (await host.page.locator('[data-a="undo"]').getAttribute('title')) === 'Undo: Skipping the reveal', await host.page.locator('[data-a="undo"]').getAttribute('title'));
  L.check('no Redo button while there is nothing to redo', (await host.page.locator('[data-a="redo"]').count()) === 0);
  await host.page.locator('[data-a="skip"]').first().click({ timeout: 10000 });
  await host.page.waitForFunction(() => document.querySelector('[data-a="undo"]')?.getAttribute('title') === 'Undo: Passing the crown', null, { timeout: 8000 }).catch(() => {});
  const leadBefore = await players[0].text();
  if (SHOTS) await host.shot(SHOTS, 'engine-quest-host-undo');

  // Undo: every phone follows, players are told.
  await host.page.locator('[data-a="undo"]').click();
  await host.page.locator('[data-a="redo"]').waitFor({ timeout: 8000 }).catch(() => {});
  L.check('the host is told what was undone', /Undone: Passing the crown/.test(await toastOf(host)), await toastOf(host));
  const told = await Promise.all(players.map(toastOf));
  L.check('every player phone says “The host went back a step.”', told.every((t) => t === 'The host went back a step.'), told.join(' | '));
  L.check('Redo appears and names the step', (await host.page.locator('[data-a="redo"]').getAttribute('title')) === 'Redo: Passing the crown');
  if (SHOTS) await host.shot(SHOTS, 'engine-quest-host-redo');
  await sleep(500);
  L.check('the crown is back with the leader from before the pass', (await players[0].text()) !== leadBefore);
  await host.page.locator('[data-a="redo"]').click();
  await host.page.locator('[data-a="redo"]').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  L.check('Redo brings the step back and the Redo button goes', (await host.page.locator('[data-a="redo"]').count()) === 0 && /Redone: Passing the crown/.test(await toastOf(host)), await toastOf(host));
  L.check('players are told the host redid a step', (await Promise.all(players.map(toastOf))).every((t) => t === 'The host redid a step.'));
  L.check('and the crown is passed again', (await players[0].text()) === leadBefore);

  // Five rejected parties: the leader picks and starts the vote, everyone rejects.
  await host.page.locator('[data-a="tab"][data-v="game"]').click();
  for (let round = 0; round < 5; round++) {
    let leader = null;
    for (let k = 0; k < 40 && !leader; k++) { for (const p of all) if ((await p.text()).includes('You Wear the Crown')) leader = p; if (!leader) await sleep(250); }
    if (!leader) throw new Error(`round ${round + 1}: no phone wears the crown`);
    for (let k = 0; k < 6; k++) {
      const go = leader.page.locator('[data-a="dockGo"]:not([disabled])');
      if (await go.count()) break;
      await leader.page.locator('button.servant[data-a="pick"][aria-pressed="false"]').first().click({ timeout: 3000 }).catch(() => {});
      await sleep(250);
    }
    await leader.page.locator('[data-a="dockGo"]:not([disabled])').click({ timeout: 5000 });
    for (const p of all) await p.page.locator('[data-a="vote"][data-v="0"]').click({ timeout: 8000 }).catch(() => {});
    await sleep(600);
  }
  await host.page.waitForFunction(() => /over|Minions|Mordred/i.test(document.body.innerText), null, { timeout: 10000 }).catch(() => {});
  for (const p of all) await p.page.keyboard.press('Escape').catch(() => {});
  const overText = await Promise.all(all.map((p) => p.page.evaluate(() => document.body.innerText)));
  L.check('five rejected parties end the game on every phone', overText.every((t) => /Minions of Mordred/i.test(t)), (await phaseOf(host)));

  // Undo from the end screen asks first; going back hides the roles again everywhere.
  await host.page.evaluate(() => { for (const b of document.querySelectorAll('[data-a="closeVictory"], .victory [data-a]')) if (/close|continue|ok/i.test(b.textContent)) b.click(); });
  await hostTab();
  await host.page.locator('[data-a="undo"]').click();
  const sheet = host.page.locator('dialog.confirm-sheet');
  await sheet.waitFor({ timeout: 5000 }).catch(() => {});
  L.check('Undo on the end screen asks first, in plain words', /Every phone hides the roles again/.test(await sheet.innerText().catch(() => '')), await sheet.innerText().catch(() => 'no sheet'));
  if (SHOTS) await host.shot(SHOTS, 'engine-quest-host-undo-over-confirm');
  await host.page.locator('dialog.confirm-sheet [data-a="confirmYes"]').click();
  await host.page.locator('[data-a="redo"]').waitFor({ timeout: 8000 }).catch(() => {});
  await sleep(500);
  const back = await Promise.all(all.map(phaseOf));
  L.check('every phone is back in the vote', back.every((x) => !/over/i.test(x)), back.join(','));
  const still = await Promise.all(players.map((p) => p.page.evaluate(() => { const t = document.body.innerText; const i = t.search(/Play again|Game Over/i); return i < 0 ? '' : t.slice(Math.max(0, i - 80), i + 40).replace(/\s+/g, ' '); })));
  L.check('no phone still shows the end screen', still.every((x) => !x), still.filter(Boolean)[0] || '');
  await host.page.locator('[data-a="redo"]').click();
  await sleep(800);
  L.check('Redo ends the game again', (await Promise.all(all.map((p) => p.page.evaluate(() => document.body.innerText)))).every((t) => /Minions of Mordred/i.test(t)));
  await checkPhones(L, all, 'after undo and redo');
} catch (e) {
  L.check('suite ran to the end', false, String(e && e.message || e).split('\n')[0]);
} finally {
  await browser.close(); srv.stop(); L.done();
}
