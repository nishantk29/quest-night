// E2E (Chromium + WebKit, motion on and reduced): opening the FAQ page from home, and opening one question, runs only
// transform/opacity animations of at most 250 ms. No view transition snapshot groups (they animate width, height and
// backdrop-filter) and no blur. With reduced motion nothing moves at all. Playtest feedback, Oct 30 2026: "The animation when you open FAQS is also janky".
// Run: node test/e2e/faq-open.e2e.mjs   (starts `wrangler dev --local`; BASE=... uses a running one)
import { fileURLToPath } from 'node:url';
import { ledger, server, PW_ENTRY } from './phones.mjs';

// Playwright is an optional dev tool; phones.mjs resolves it (PW env override, else the `playwright-core` package).
const { chromium, webkit } = await import(PW_ENTRY);
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const L = ledger('quest FAQ open e2e');
const srv = await server(ROOT);
const OK_PROPS = new Set(['opacity', 'transform', 'translate', 'scale', 'rotate']);

// Marks every animation alive now, then (after the tap) lists the new ones: what they animate and how long they run.
const mark = () => { window.__old = new Set(document.getAnimations()); };
const fresh = () => document.getAnimations().filter((a) => !window.__old.has(a)).map((a) => {
  const e = a.effect; const kf = e?.getKeyframes?.() || []; const t = e?.getComputedTiming?.() || {};
  return { name: a.animationName || (a.transitionProperty ? `transition:${a.transitionProperty}` : 'web'), on: `${e?.target?.tagName || ''}.${String(e?.target?.className?.baseVal ?? e?.target?.className ?? '').split(' ')[0]}${e?.pseudoElement || ''}`,
    props: [...new Set(kf.flatMap((k) => Object.keys(k).filter((x) => !['offset', 'easing', 'composite', 'computedOffset'].includes(x))))].concat(a.transitionProperty ? [a.transitionProperty] : []), ms: Math.round(t.endTime ?? 0) };
});

for (const engine of ['chromium', 'webkit']) {
  const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  try {
    for (const motion of ['no-preference', 'reduce']) {
      const tag = `${engine} ${motion === 'reduce' ? 'reduced motion' : 'motion on'}`;
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: engine !== 'firefox', hasTouch: true, serviceWorkers: 'block', reducedMotion: motion });
      const page = await ctx.newPage(); const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(srv.base + '/#/', { waitUntil: 'load' }); await page.waitForTimeout(700);
      // the page
      await page.evaluate(mark);
      await page.locator('a.side-card[href="#/faq"]').first().tap();
      const seen = []; for (let i = 0; i < 6; i++) { seen.push(...(await page.evaluate(fresh))); await page.waitForTimeout(40); }
      const anims = [...new Map(seen.map((a) => [`${a.name}|${a.on}`, a])).values()];
      await page.locator('.faq-q').first().waitFor({ timeout: 5000 });
      L.check(`${tag}: the FAQ page opened`, /FAQ/.test(await page.title()), await page.title());
      const bad = anims.filter((a) => a.props.some((p) => !OK_PROPS.has(p)) || a.ms > 250);
      L.check(`${tag}: opening the page animates only transform/opacity, at most 250 ms`, bad.length === 0, bad.length ? bad : anims);
      L.check(`${tag}: no view transition on the way in`, !anims.some((a) => /view-transition/.test(a.on)), anims.map((a) => a.on));
      if (motion === 'reduce') L.check(`${tag}: nothing moves when the page opens`, anims.length === 0, anims);
      else L.check(`${tag}: the page fades and slides in once (.faq-in, 200-250 ms)`, anims.some((a) => /step-in$/.test(a.name) && a.ms >= 200 && a.ms <= 250), anims);
      // one question
      await page.waitForTimeout(400);
      const q = page.locator('.faq-q').nth(1); await q.scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
      await page.evaluate(mark);
      await q.locator('summary').tap();
      const seen2 = []; for (let i = 0; i < 6; i++) { seen2.push(...(await page.evaluate(fresh))); await page.waitForTimeout(40); }
      const a2 = [...new Map(seen2.map((a) => [`${a.name}|${a.on}`, a])).values()];
      L.check(`${tag}: the question opened`, await q.evaluate((d) => d.open));
      const bad2 = a2.filter((a) => a.props.some((p) => !OK_PROPS.has(p)) || a.ms > 250);
      L.check(`${tag}: opening a question animates only transform/opacity, at most 250 ms`, bad2.length === 0, bad2.length ? bad2 : a2);
      if (motion === 'reduce') L.check(`${tag}: nothing moves when a question opens`, a2.length === 0, a2);
      const blur = await page.evaluate(() => [...document.querySelectorAll('#app > main, #app > main *')].filter((el) => { const s = getComputedStyle(el); return /blur/.test(s.backdropFilter || s.webkitBackdropFilter || '') || /blur/.test(s.filter); }).length);
      L.check(`${tag}: nothing on the FAQ page is blurred`, blur === 0, blur);
      L.check(`${tag}: no page errors`, errs.length === 0, errs);
      await ctx.close();
    }
  } finally { await browser.close(); }
}
srv.stop();
L.done();
