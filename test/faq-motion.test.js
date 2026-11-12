// Playtest feedback, Oct 30 2026 (Mafia Night): "The animation when you open FAQS is also janky". Same cause here: opening the FAQ
// ran the step view transition, whose snapshot groups animate width, height and backdrop-filter. Opening the FAQ page
// animates transform and opacity only, 200-250 ms with the kit easing, never height, max-height, width or blur, and
// uses no view transition. With reduced motion (or Animations off) the FAQ shows at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as mb from './kit/motion-budget.mjs';

const pub = fileURLToPath(new URL('../public', import.meta.url));
const sources = mb.cssSources(pub);
const props = mb.customProps(sources);
const FAQ = /faq/; // the home-rules card keeps its 90-150 ms press feedback (motion-budget press rule); the open itself is .faq-in
const LAYOUT = /(^|[^\w-])(height|max-height|min-height|width|max-width|filter|backdrop-filter|-webkit-backdrop-filter|all)\b/;
const kfOf = (srcs) => { const k = new Map(); for (const { css } of srcs) for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) k.set(m[1], [...new Set([...m[2].matchAll(/([\w-]+)\s*:/g)].map((x) => x[1]))]); return k; };
const keyframes = kfOf(sources);

// Every animation or transition declared on a FAQ selector (outside the reduced-motion / Animations-off fallbacks).
function faqMotion(srcs = sources) {
  const out = []; const kf = srcs === sources ? keyframes : kfOf(srcs);
  for (const d of mb.declarations(srcs)) {
    if (!FAQ.test(d.ctx) || /none/.test(d.value)) continue;
    for (const layer of mb.splitTop(d.value, ',')) {
      const toks = mb.splitTop(layer.trim(), ' ');
      const times = toks.filter((t) => mb.isTimeToken(t, props)).map((t) => mb.evalTime(t, props));
      const name = d.prop.startsWith('animation') ? toks.find((t) => kf.has(t)) : null;
      const animates = d.prop.startsWith('transition') ? [toks[0]] : name ? kf.get(name) : [];
      out.push({ where: `${d.file} ${d.ctx.trim()} {${d.prop}:${layer.trim()}}`, ms: times[0] ?? null, end: times.length > 1 ? times[0] + times[1] : times[0] ?? null, animates, ease: toks.find((t) => /ease|cubic-bezier|linear/.test(t)) || '' });
    }
  }
  return out;
}
const problems = (rows) => rows.flatMap((r) => [
  ...r.animates.filter((p) => LAYOUT.test(p)).map((p) => `${r.where}: animates ${p}`),
  ...(r.ms == null ? [`${r.where}: duration not static`] : r.end > 250 ? [`${r.where}: runs ${r.end}ms (over 250)`] : r.ms < 200 ? [`${r.where}: ${r.ms}ms (under 200)`] : []),
  ...(r.ease && r.ease !== 'var(--qn-ease)' ? [`${r.where}: easing ${r.ease} is not the kit's --qn-ease`] : []),
]);

test('FAQ open motion: transform/opacity only, 200-250 ms, kit easing', () => {
  const rows = faqMotion();
  assert.ok(rows.some((r) => /\.faq-in/.test(r.where) && r.ms === 220), 'the FAQ page entrance is found (220 ms)');
  assert.deepEqual(problems(rows), []);
  assert.deepEqual(keyframes.get('qn-step-in').sort(), ['opacity', 'transform']);
});

test('no view transition on the FAQ: no view-transition-name on FAQ or home-rules selectors, and motion.js skips startViewTransition', () => {
  const named = sources.flatMap(({ file, css }) => [...css.matchAll(/([^{}]*)\{[^{}]*view-transition-name\s*:\s*([\w-]+)/g)].filter((m) => /faq|home-rules/.test(m[1]) && m[2] !== 'none').map((m) => `${file}: ${m[1].trim()} -> ${m[2]}`));
  assert.deepEqual(named, []);
  assert.doesNotMatch(sources.map((s) => s.css).join('\n'), /view-transition-group\(rules-card\)/);
});

test('reduced motion and Animations off: the FAQ entrance is switched off', () => {
  const css = sources.map((x) => x.css).join('\n');
  assert.match(css, /\.fx-off \.faq-in\{animation:none\}/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.faq-in\{animation:none\}\}/);
});

test('app.js render(): a hop to or from the FAQ paints and replays .faq-in before any startViewTransition', () => {
  const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
  const r = app.slice(app.indexOf('function render() {'));
  const hop = r.search(/faqHop\) \{ paint\(\); replayIn\(.*, 'faq-in'\); return; \}/);
  assert.ok(hop > 0, 'the FAQ hop branch is there');
  assert.ok(hop < r.indexOf('startViewTransition'), 'and it runs before the view transition');
  assert.match(app, /const isFaqKey = \(k\) => typeof k === 'string' && k\.startsWith\('faq\|'\);/);
});

test('the scan catches violations (verified red)', () => {
  const src = (css) => [{ file: 'x.css', css: `:root{--qn-ease:cubic-bezier(.2,.8,.2,1)}@keyframes grow{from{max-height:0}to{max-height:900px}}${css}` }];
  const bad = (css) => problems(faqMotion(src(css))).length;
  assert.ok(bad('.faq-a{transition:max-height 220ms var(--qn-ease)}'), 'height transition');
  assert.ok(bad('.faq-a{animation:grow 220ms var(--qn-ease) both}'), 'height keyframes');
  assert.ok(bad('.faq-sheet{transition:backdrop-filter 220ms var(--qn-ease)}'), 'blur');
  assert.ok(bad('.faq-q .ui-ico{transition:transform 400ms var(--qn-ease)}'), 'over 250 ms');
  assert.equal(bad('.faq-q .ui-ico{transition:transform 220ms var(--qn-ease)}'), 0, 'a good one passes');
});
