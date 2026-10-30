// Browser e2e for the setup carousel, presets page and roles panel: a host and 4 phones go through the four steps to the deal.
//   node test/e2e/setup-carousel.e2e.mjs                                    starts a local dev server from this repo, stops it after
//   BASE=http://127.0.0.1:8946 SHOTS=/path node test/e2e/setup-carousel.e2e.mjs   against a server that is already running
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { server, launch, phone, ledger, checkPhones } from './phones.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS = process.env.SHOTS || join(root, '.wrangler/e2e-shots');
const L = ledger('quest setup carousel e2e');
const srv = await server(root);
const browser = await launch();
const top = (p) => p.page.evaluate(() => scrollTo(0, 0));
// Every visible control in the setup is at least 44px tall, and no text is under 13px.
const audit = (p) => p.page.evaluate(() => {
  const bad = [];
  for (const e of document.querySelectorAll('.cs button, .cs input, .cs summary, .roles-chip, .roles-panel button')) {
    if (e.type === 'checkbox' && e.closest('label')?.getBoundingClientRect().height >= 43.5) continue; // the whole label is the target
    const r = e.getBoundingClientRect(); if (!r.width || !r.height || getComputedStyle(e).visibility === 'hidden') continue;
    if (r.height < 43.5) bad.push(`${e.className || e.tagName} ${Math.round(r.height)}px`);
  }
  for (const e of document.querySelectorAll('.cs *, .roles-panel *')) {
    if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (parseFloat(getComputedStyle(e).fontSize) < 12.99) bad.push(`text ${e.className || e.tagName} ${getComputedStyle(e).fontSize}`);
  }
  return [...new Set(bad)];
});
const NAMES = ['Ana', 'Ben', 'Cal', 'Dee'];
try {
  const host = await phone(browser, srv.base, 'Host', 'p390');
  const hp = host.page;
  await host.goto('/');
  await hp.fill('[data-i="hostName"]', 'Hal');
  await hp.click('[data-a="host"]');
  await hp.waitForSelector('.cs[data-step="0"]');
  const code = (await hp.textContent('.cs-code-v')).trim();
  L.check('host lands on step 1 with a room code', /^[A-Z]{6}$/.test(code), code);
  L.check('step 1 shows the heading and a disabled Next with the reason', (await hp.textContent('#cs-h')).includes('Who’s playing?') && (await hp.getAttribute('.cs-btn', 'aria-disabled')) === 'true');
  const why = (await hp.textContent('#cs-why')) || '';
  L.check('reason names the fix: Add 4 more players', /Add 4 more players to start \(5 minimum\)/.test(why), why);
  L.check('Next is tied to the reason with aria-describedby', (await hp.getAttribute('.cs-btn', 'aria-describedby')) === 'cs-why');
  await host.shot(SHOTS, 'step1-short-390');

  const phones = [];
  for (const nm of NAMES) {
    const p = await phone(browser, srv.base, nm, 'p390');
    await p.goto(`/#/play/${code}`);
    // Live rooms: the socket may still be opening, so retry the join until the lobby shows (max 4 tries).
    for (let t = 0; t < 4; t++) {
      await p.page.fill('[data-i="joinName"]', nm).catch(() => {});
      await p.page.click('[data-a="join"]', { timeout: 3000 }).catch(() => {});
      if (await p.page.waitForSelector('.layout', { timeout: 5000 }).then(() => true, () => false)) break;
    }
    phones.push(p);
  }
  await hp.waitForFunction(() => document.querySelectorAll('.cs-chip').length === 5);
  L.check('five chips after four phones join', true);
  L.check('Next is enabled with five players', (await hp.getAttribute('.cs-btn', 'aria-disabled')) === null);
  L.check('step 1: targets are 44px+ and text 13px+', (await audit(host)).length === 0, await audit(host));
  await host.shot(SHOTS, 'step1-players-390');

  await hp.click('.cs-btn');
  await hp.waitForSelector('.cs[data-step="1"]');
  L.check('step 2 opens with the focus on its heading', await hp.evaluate(() => document.activeElement?.id === 'cs-h'));
  L.check('step 2: The Round Table is preselected', (await hp.textContent('.cs-vellum h2')).includes('The Round Table'));
  L.check('step 2: targets are 44px+ and text 13px+', (await audit(host)).length === 0, await audit(host));
  await host.shot(SHOTS, 'step2-preset-390');

  // presets page
  await hp.click('[data-a="presetsOpen"]');
  await hp.waitForSelector('.pr-list');
  const names = await hp.$$eval('.pr h3', (e) => e.map((x) => x.textContent));
  L.check('presets page lists the six, Recommended pinned first', names.join('|') === ['The Round Table', 'Plain Steel', 'Seer and Shield', 'The Outcast', 'Mordred’s Veil', 'Full Court'].join('|'), names);
  L.check('out-of-range presets are dimmed but openable', (await hp.$$eval('.pr.off', (e) => e.length)) === 3 && !(await hp.$eval('.pr.off .pr-main', (e) => e.disabled)));
  await host.shot(SHOTS, 'presets-390');
  await hp.click('[data-id="outcast"]');
  await hp.waitForSelector('.preset-sheet');
  const misfitText = await hp.textContent('.preset-sheet');
  L.check('misfit sheet says "Needs 7+ players. You have 5."', misfitText.includes('Needs 7+ players. You have 5.') && misfitText.includes('Add players') && misfitText.includes('Pick another') && !misfitText.includes('Use this'), misfitText.slice(0, 120));
  await host.shot(SHOTS, 'preview-misfit-390');
  await hp.click('.preset-sheet >> text=Pick another');
  await hp.click('[data-id="seer-shield"]');
  await hp.waitForSelector('.preset-sheet');
  L.check('preview shows Use this and Customize from here', (await hp.textContent('.preset-sheet')).includes('Use this') && (await hp.textContent('.preset-sheet')).includes('Customize from here'));
  await host.shot(SHOTS, 'preview-390');
  await hp.click('.preset-sheet >> text=Use this');
  await hp.waitForFunction(() => document.querySelector('.cs-vellum h2')?.textContent.includes('Seer and Shield'));
  L.check('Use this returns to step 2 with Seer and Shield', true);

  // customize, save, rename, delete
  await hp.click('[data-a="customize"]');
  await hp.waitForSelector('[data-i="presetName"]');
  await host.shot(SHOTS, 'customize-390');
  await hp.fill('[data-i="presetName"]', 'Friday table');
  await hp.click('[data-a="savePreset"]');
  await hp.waitForSelector('.cs[data-step="1"] .cs-vellum');
  await hp.click('[data-a="presetsOpen"]');
  await hp.waitForSelector('.pr-saved');
  L.check('saved preset appears under "Saved on this phone"', (await hp.textContent('.cs-card')).includes('Friday table'));
  await host.shot(SHOTS, 'presets-saved-390');
  await hp.click('[data-a="savedMenu"]');
  await hp.waitForSelector('.saved-sheet');
  await hp.fill('#sv-name', 'Friday night');
  await hp.click('.saved-sheet >> text="Save"');
  await hp.waitForFunction(() => document.querySelector('.cs-card')?.textContent.includes('Friday night'));
  L.check('Rename works', true);
  await hp.click('[data-a="savedMenu"]');
  await hp.click('.saved-sheet >> text=Delete');
  await hp.click('.saved-sheet >> text=Tap again to delete');
  await hp.waitForFunction(() => !document.querySelector('.pr-saved'));
  L.check('Delete asks once, then removes it', true);
  await hp.click('[data-a="presetsBack"]');
  await hp.waitForSelector('.cs[data-step="1"]');

  // refresh mid-carousel restores the step
  await hp.reload({ waitUntil: 'domcontentloaded' });
  await hp.waitForSelector('.cs[data-step="1"]');
  L.check('refresh on step 2 lands on step 2 with the same preset', (await hp.textContent('.cs-vellum h2')).includes('Seer and Shield'));

  // swipe is extra: a left drag goes forward, a right drag goes back
  await hp.mouse.move(320, 520); await hp.mouse.down(); await hp.mouse.move(120, 525, { steps: 6 }); await hp.mouse.up();
  await hp.waitForSelector('.cs[data-step="2"]');
  L.check('swipe left moves to the next step', true);
  await hp.mouse.move(120, 520); await hp.mouse.down(); await hp.mouse.move(330, 525, { steps: 6 }); await hp.mouse.up();
  await hp.waitForSelector('.cs[data-step="1"]');
  L.check('swipe right moves back', true);
  await hp.click('.cs-back');
  await hp.waitForSelector('.cs[data-step="0"]');
  L.check('Back goes to step 1, and Back is hidden there', (await hp.$$('.cs-back')).length === 0);
  await hp.click('.cs-btn');
  await hp.waitForSelector('.cs[data-step="1"]');

  // seating
  await hp.click('.cs-btn');
  await hp.waitForSelector('.cs[data-step="2"]');
  L.check('step 3: Own phones preselected (everyone joined)', (await hp.getAttribute('.cs-opt.on', 'data-v')) === 'own');
  L.check('step 3: Next is never disabled', (await hp.getAttribute('.cs-btn', 'aria-disabled')) === null);
  L.check('step 3: targets are 44px+ and text 13px+', (await audit(host)).length === 0, await audit(host));
  await host.shot(SHOTS, 'step3-seating-390');
  await hp.click('.cs-btn');
  await hp.waitForSelector('.cs[data-step="3"]');
  const sums = await hp.textContent('.cs-sums');
  L.check('step 4 summary rows: players, roles, seating', /Players\s*5/.test(sums) && /Seer and Shield/.test(sums) && /Own phones/.test(sums), sums.replace(/\s+/g, ' '));
  L.check('Advanced is collapsed by default', (await hp.getAttribute('[data-adv]', 'open')) === null);
  L.check('step 4: targets are 44px+ and text 13px+', (await audit(host)).length === 0, await audit(host));
  await host.shot(SHOTS, 'step4-deal-390');
  await hp.click('[data-adv] summary');
  await host.shot(SHOTS, 'step4-advanced-390');
  await hp.click('[data-adv] summary');
  await hp.click('[aria-label="Edit seating"]');
  await hp.waitForSelector('.cs[data-step="2"]');
  await hp.click('.cs-btn');
  await hp.waitForSelector('.cs[data-step="3"]');
  await hp.click('[data-a="csDeal"]');
  await hp.waitForSelector('.roles-panel');
  await Promise.all(phones.map((p) => p.page.waitForSelector('.roles-panel')));
  L.check('every phone shows "Roles in this game" before the reveal', true);
  const panelTexts = [];
  for (const p of [host, ...phones]) panelTexts.push((await p.page.textContent('.roles-panel')).replace(/\s+/g, ' ').replace(/See my role|Close/, '').trim());
  L.check('the panel text is identical on all five phones', new Set(panelTexts).size === 1, panelTexts[0].slice(0, 100));
  L.check('the button reads "See my role"', (await hp.textContent('.roles-panel .btn')).trim() === 'See my role');
  L.check('roles panel: targets are 44px+ and text 13px+', (await audit(host)).length === 0, await audit(host));
  await host.shot(SHOTS, 'roles-panel-390');
  for (const p of [host, ...phones]) await p.page.click('[data-a="rolesSeen"]');
  await hp.waitForSelector('.roles-chip');
  L.check('header chip reads "5 roles"', (await hp.textContent('.roles-chip')).trim() === '5 roles');
  await host.shot(SHOTS, 'chip-390');
  await hp.click('.roles-chip');
  await hp.waitForSelector('.roles-sheet');
  const sheetText = (await hp.textContent('.roles-sheet .sheet-body')).replace(/\s+/g, ' ');
  L.check('chip opens the same list as a sheet', sheetText.includes('Percival') && sheetText.includes('Morgana'));
  await host.shot(SHOTS, 'chip-sheet-390');
  await hp.click('.roles-sheet >> text=Close');
  await checkPhones(L, [host, ...phones], 'at 390x844');

  // 375x667 and 1280x800 on a fresh room: the key screens, with names added on the host phone
  for (const dev of ['p375', 'd1280']) {
    const h = await phone(browser, srv.base, `Host-${dev}`, dev);
    await h.goto('/'); await h.page.fill('[data-i="hostName"]', 'Hal'); await h.page.click('[data-a="host"]');
    await h.page.waitForSelector('.cs[data-step="0"]');
    const tag = dev === 'p375' ? '375' : '1280';
    const extra = ['Ann', 'Bo', 'Cy', 'Di'];
    for (const [i, nm] of extra.entries()) { await h.page.fill('[data-i="seatName"]', nm); await h.page.click('[data-a="addSeat"]'); await h.page.waitForFunction((k) => document.querySelectorAll('.cs-chip').length >= k, i + 2); }
    L.check(`${tag}: step 1 fits width`, !(await h.overflow()) && await h.page.evaluate(() => [...document.querySelectorAll('.cs *')].every((e) => e.getBoundingClientRect().right <= document.querySelector('.cs').getBoundingClientRect().right + 1)));
    await top(h); await h.shot(SHOTS, `step1-players-${tag}`);
    await h.page.click('.cs-btn'); await h.page.waitForSelector('.cs[data-step="1"]');
    L.check(`${tag}: step 2 fits width`, !(await h.overflow()));
    await top(h); await h.shot(SHOTS, `step2-preset-${tag}`);
    await h.page.click('.cs-btn'); await h.page.waitForSelector('.cs[data-step="2"]');
    L.check(`${tag}: all seats on this phone -> One phone preselected`, (await h.page.getAttribute('.cs-opt.on', 'data-v')) === 'one');
    await top(h); await h.shot(SHOTS, `step3-seating-${tag}`);
    await h.page.click('.cs-btn'); await h.page.waitForSelector('.cs[data-step="3"]');
    L.check(`${tag}: step 4 fits width`, !(await h.overflow()));
    await top(h); await h.shot(SHOTS, `step4-deal-${tag}`);
    await h.page.click('[data-a="csDeal"]');
    await h.page.waitForSelector('.roles-panel');
    L.check(`${tag}: one-phone deal shows the roles panel`, /Close|See my role/.test(await h.page.textContent('.roles-panel .btn')));
    await top(h); await h.shot(SHOTS, `roles-panel-${tag}`);
    await checkPhones(L, [h], `at ${tag}`);
    await h.close();
  }
  for (const p of [host, ...phones]) await p.close();
} catch (e) { L.check('e2e ran to the end', false, String(e?.stack || e).slice(0, 600)); }
finally { await browser.close(); srv.stop(); L.done(); }
