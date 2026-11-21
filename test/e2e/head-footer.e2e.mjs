// E2E (browser, Chromium, 390px phone): the home page boots with the modulepreload list in the head (every preloaded
// module is used, none fetched twice, no page errors); the footer links every game and each link is a 44px target;
// the credit links are 44px tall; the Tools pill's press scale applies only when reduced motion is off.
// Run: node test/e2e/head-footer.e2e.mjs   (starts wrangler dev)   or BASE=https://<host>
import { fileURLToPath } from 'node:url';
import { ledger, server, launch, phone } from './phones.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const L = ledger('quest head + footer e2e');
const srv = await server(ROOT);
const browser = await launch();
try {
  const p = await phone(browser, srv.base, 'home');
  const P = p.page;
  const js = [];
  P.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/js/')) js.push(u.pathname); });
  const warns = [];
  P.on('console', (m) => { if (/preload/i.test(m.text())) warns.push(m.text()); });
  await P.goto(srv.base + '/', { waitUntil: 'load' });
  await P.locator('.site-foot').waitFor({ state: 'visible', timeout: 15000 });
  await P.waitForTimeout(3500); // Chrome warns about an unused preload a few seconds after load

  // 1. modulepreload
  const pre = await P.$$eval('link[rel="modulepreload"]', (x) => x.map((e) => new URL(e.href).pathname));
  L.check('1 the head preloads the app modules', pre.length > 20 && pre.includes('/js/app.js'), pre.length);
  const twice = js.filter((u, i) => js.indexOf(u) !== i);
  L.check('1 no module is fetched twice', twice.length === 0, twice);
  L.check('1 every preloaded module was requested', pre.every((u) => js.includes(u)), pre.filter((u) => !js.includes(u)));
  L.check('1 no unused-preload warnings', warns.length === 0, warns);

  // 2. footer links
  const links = await P.$$eval('.site-foot nav a', (x) => x.map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim(), h: e.getAttribute('href'), w: Math.round(r.width), hh: Math.round(r.height) }; }));
  const names = links.map((l) => l.t);
  L.check('2 footer lists all games', ['All games', 'Mafia Night', 'The Gilded Chamber', 'Brass Wallet', 'The Odd Card', 'Quest Night'].every((n) => names.includes(n)), names);
  L.check('2 Brass Wallet and The Odd Card point at their sites', links.some((l) => l.h === 'https://brass.hatethespurs.com') && links.some((l) => l.h === 'https://oddcard.hatethespurs.com'));
  L.check('2 every footer link is 44px tall', links.every((l) => l.hh >= 44), links.filter((l) => l.hh < 44));

  // 3. credit links
  await P.locator('.credits-box summary').click();
  const credits = await P.$$eval('.credits-box p a', (x) => x.map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) }; }));
  L.check('3 credit links are 44px tall', credits.length >= 2 && credits.every((c) => c.h >= 44), credits);

  // 4. the pill press: scale only without reduced motion (the phone context runs with reduced motion on)
  const pressMedia = () => P.evaluate(() => {
    for (const s of document.styleSheets) for (const r of s.cssRules) if (r instanceof CSSMediaRule && [...r.cssRules].some((x) => x.selectorText === '.tabbar .more-pill:active')) return { media: r.conditionText, on: matchMedia(r.conditionText).matches };
    return null;
  });
  const reduced = await pressMedia();
  L.check('4 the press rule sits behind prefers-reduced-motion:no-preference', !!reduced && /prefers-reduced-motion:\s*no-preference/.test(reduced.media), reduced);
  L.check('4 reduced motion: the press scale does not apply', reduced && reduced.on === false);
  await P.emulateMedia({ reducedMotion: 'no-preference' });
  const full = await pressMedia();
  L.check('4 full motion: the press scale applies', full && full.on === true);

  L.check('no page or console errors', p.errors.length === 0, p.errors.slice(0, 3));
} catch (e) {
  L.check('run finished without throwing', false, e.stack);
} finally {
  await browser.close(); srv.stop();
}
L.done();
