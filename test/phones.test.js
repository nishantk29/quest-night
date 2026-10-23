import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createReveal } from '../public/js/reveal.js';
import { haptic, createWakeLock, wantsWakeLock } from '../public/js/device.js';
import { screenKey, stepAt } from '../public/js/motion.js';
import { encodeQR, qrSvg } from '../public/js/qr.js';

const read = (f) => fs.readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');

function clock() {
  let t = 0; const q = [];
  return { now: () => t, set: (fn, ms) => { const h = { fn, at: t + ms }; q.push(h); return h; }, clear: (h) => { const i = q.indexOf(h); if (i >= 0) q.splice(i, 1); },
    tick(ms) { t += ms; for (const h of q.filter((x) => x.at <= t)) { q.splice(q.indexOf(h), 1); h.fn(); } } };
}

test('reveal: a hold shows the card and release hides it at once', () => {
  const c = clock(); const log = [];
  const r = createReveal({ onChange: (on) => log.push(on), now: c.now, set: c.set, clear: c.clear });
  r.press(); assert.equal(r.shown, true);
  c.tick(900); assert.equal(r.shown, true, 'stays while held');
  r.release(); assert.equal(r.shown, false);
  assert.deepEqual(log, [true, false]);
});

test('reveal: a quick tap shows the card, then it re-blurs by itself', () => {
  const c = clock(); const r = createReveal({ now: c.now, set: c.set, clear: c.clear });
  r.press(); c.tick(80); r.release();
  assert.equal(r.shown, true);
  c.tick(3900); assert.equal(r.shown, true);
  c.tick(200); assert.equal(r.shown, false);
});

test('reveal: tapping a visible card hides it, and a forgotten hold re-blurs', () => {
  const c = clock(); const r = createReveal({ now: c.now, set: c.set, clear: c.clear });
  r.press(); c.tick(50); r.release();
  r.press(); assert.equal(r.shown, false); r.release(); assert.equal(r.shown, false);
  r.press(); c.tick(12001); assert.equal(r.shown, false, 'held too long');
  r.release(); assert.equal(r.shown, false);
});

test('reveal: every role takes the same path (timing does not depend on who you are)', () => {
  const run = () => { const c = clock(); const log = []; const r = createReveal({ onChange: (on) => log.push([c.now(), on]), now: c.now, set: c.set, clear: c.clear }); r.press(); c.tick(60); r.release(); c.tick(5000); return JSON.stringify(log); };
  assert.equal(run(), run());
});

test('haptic: feature-detected, never throws', () => {
  assert.equal(haptic(10, {}), false);
  assert.equal(haptic(10, { vibrate: () => { throw new Error('no'); } }), false);
  let got; assert.equal(haptic(15, { vibrate: (ms) => { got = ms; return true; } }), true); assert.equal(got, 15);
});

test('wake lock: only during a running game; re-acquired when the tab returns', async () => {
  assert.equal(wantsWakeLock(null), false);
  assert.equal(wantsWakeLock({ phase: 'lobby' }), false);
  assert.equal(wantsWakeLock({ phase: 'vote', game: {} }), true);
  assert.equal(wantsWakeLock({ phase: 'over', game: {} }), false);
  let requests = 0; let released = 0; let onVis;
  const doc = { visibilityState: 'visible', addEventListener: (_, f) => { onVis = f; } };
  const nav = { wakeLock: { request: async () => { requests++; const l = {}; return { release: async () => { released++; }, addEventListener: (_, f) => { l.f = f; } }; } } };
  const wl = createWakeLock(nav, doc);
  wl.set(true); await new Promise((r) => setTimeout(r, 0));
  assert.equal(requests, 1); assert.equal(wl.held, true);
  wl.set(true); await new Promise((r) => setTimeout(r, 0)); assert.equal(requests, 1, 'no duplicate request');
  wl.set(false); assert.equal(released, 1); assert.equal(wl.held, false);
  createWakeLock({}, doc).set(true); // unsupported browser: no error
  void onVis;
});

test('motion: screen key changes per phase and quest, not per live update', () => {
  const base = { mode: 'play', code: 'ABCDEF', view: { phase: 'vote', game: { quest: 1 } } };
  assert.equal(screenKey(base), screenKey({ ...base, view: { phase: 'vote', game: { quest: 1 }, players: [1] } }));
  assert.notEqual(screenKey(base), screenKey({ ...base, view: { phase: 'quest', game: { quest: 1 } } }));
  assert.notEqual(screenKey(base), screenKey({ ...base, view: { phase: 'vote', game: { quest: 2 } } }));
  assert.notEqual(screenKey(base), screenKey({ mode: 'home' }));
});

test('carousel: the dot follows the snap position', () => {
  assert.equal(stepAt(0, 300, 4), 0);
  assert.equal(stepAt(160, 300, 4), 1);
  assert.equal(stepAt(9999, 300, 4), 3);
  assert.equal(stepAt(10, 0, 4), 0);
});

test('QR: encodes the join link locally into an SVG', () => {
  const url = 'https://quest-night.example.workers.dev/#/play/ABCDEF';
  const { size, rows } = encodeQR(url);
  assert.ok(size >= 21 && rows.length === size);
  const svg = qrSvg(url, 'QR code to join room ABCDEF');
  assert.match(svg, /^<svg class="qr"/); assert.match(svg, /aria-label="QR code to join room ABCDEF"/);
  assert.doesNotMatch(read('js/qr.js'), /https?:\/\/(?!www\.w3\.org)/);
});

test('phones mode: Success and Sabotage look identical for every role', () => {
  const app = read('js/app.js');
  const i = app.indexOf('Play Your Card');
  const block = app.slice(i, app.indexOf("if (v.phase === 'lantern')", i));
  assert.doesNotMatch(block, /aria-disabled|good|side/, 'no role-dependent markup or words');
  assert.match(block, /class="choice success"[\s\S]*class="choice sabotage"/);
  assert.match(read('motion.css'), /\.choice-pair \.choice\{min-height/);
});

test('phones mode: the hidden card never contains the role', () => {
  const app = read('js/app.js');
  const hidden = app.slice(app.indexOf('<div class="cardart a-hidden">'), app.indexOf('const card = `<button'));
  assert.doesNotMatch(hidden, /r\.name|r\.side|r\.icon|r\.blurb|sees|lan\b/);
  const marks = app.slice(app.indexOf('function marksFor'), app.indexOf('function lanternMark'));
  assert.match(marks, /if \(S\.ui\.showCard\) for \(const k of v\.me\?\.sees/);
});

test('motion CSS is gated: @supports, reduced motion and the Animations switch', () => {
  const css = read('motion.css');
  assert.match(css, /@supports \(animation-timeline: view\(\)\)/);
  assert.match(css, /prefers-reduced-motion: no-preference/);
  assert.match(css, /html:not\(\.fx-off\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /scroll-snap-type:x mandatory/); assert.match(css, /overscroll-behavior-x:contain/);
  assert.match(read('js/app.js'), /canTransition\(\)/);
  assert.match(read('js/app.js'), /fx\.enabled\(\) && canTransition/);
});

test('every startViewTransition use handles aborted transitions and still paints', () => {
  const files = fs.readdirSync(new URL('../public/js/', import.meta.url)).filter((f) => f.endsWith('.js'));
  const uses = files.flatMap((f) => [...read(`js/${f}`).matchAll(/startViewTransition\(/g)].map(() => f));
  assert.ok(uses.length > 0, 'expected at least one startViewTransition call');
  for (const f of new Set(uses)) {
    const src = read(`js/${f}`);
    const call = src.indexOf('startViewTransition(');
    const block = src.slice(src.lastIndexOf('try {', call), src.indexOf('catch {', call) + 'catch { clearTimeout(guard); once(); }'.length);
    assert.match(block, /^try \{/, `${f}: startViewTransition must be wrapped in try/catch`);
    assert.match(block, /catch \{ clearTimeout\(guard\); once\(\); \}$/, `${f}: a synchronous throw must still paint`);
    for (const p of ['ready', 'updateCallbackDone', 'finished']) {
      assert.match(block, new RegExp(`vt\\.${p}\\b`), `${f}: ${p} must be observed`);
      assert.match(block, new RegExp(`p\\.catch\\(`), `${f}: ${p} rejection must be caught`);
    }
  }
});

test('theme display font is declared and preloaded', () => {
  assert.match(read('theme.css'), /--font-display:"Rubik"/);
  assert.match(read('styles.css'), /@font-face\{font-family:"Rubik"[^}]*rubik-var\.woff2/);
  assert.match(read('index.html'), /rel="preload" href="\/fonts\/rubik-var\.woff2"/);
});

test('copy: Host, never storyteller, in visible strings', () => {
  for (const f of ['js/app.js', 'js/faq.js', 'js/table_ui.js']) {
    const lines = read(f).split('\n').filter((l) => !/^\s*\/\//.test(l));
    assert.deepEqual(lines.filter((l) => /storyteller/i.test(l)), [], f);
  }
});

test('service worker precaches the new files', () => {
  const sw = read('sw.js');
  for (const f of ['/motion.css', '/js/reveal.js', '/js/device.js', '/js/motion.js', '/js/qr.js']) assert.ok(sw.includes(`'${f}'`), f);
});
