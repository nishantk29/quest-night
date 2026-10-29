// Arriving from the Game Night hub (Nishant, Oct 28 9:08 PM ET: "That logo moving on game night is kinda janky"):
// one opacity fade of the page, at most 300 ms, nothing moves, nothing loops, and nothing at all under reduced motion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const rd = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const css = rd('redesign.css').replace(/\/\*[\s\S]*?\*\//g, ''), html = rd('index.html');
const scale = +(rd('styles.css') + rd('redesign.css')).match(/--dur-scale:\s*([\d.]+)/)[1];
const hubRules = [...css.matchAll(/([^{}]*(?:\.hand\b|#hand)[^{}]*)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));

test('the arrival is a single opacity fade of the page, <= 300 ms at --dur-scale', () => {
  const fades = hubRules.filter((r) => /animation:/.test(r.body) && !/animation:none/.test(r.body));
  assert.equal(fades.length, 1, JSON.stringify(fades));
  assert.equal(fades[0].sel, '.hand #app,.hand .bg-art');
  const m = fades[0].body.match(/animation:qn-hub-fade calc\((\d+)ms \* var\(--dur-scale\)\)/);
  assert.ok(m && +m[1] * scale <= 300, fades[0].body);
  assert.match(css, /@keyframes qn-hub-fade\{from\{opacity:0\}to\{opacity:1\}\}/);
});
test('nothing moves on arrival: no logo overlay, no FLIP, no transform or transition, the rise is skipped', () => {
  assert.doesNotMatch(html, /id="hand"|hand-logo|\.animate\(|hand-go/);
  assert.doesNotMatch(css, /#hand\b|hand-go/);
  for (const r of hubRules) assert.doesNotMatch(r.body, /transform|transition|infinite/, r.sel);
  assert.ok(hubRules.some((r) => r.sel === '.hand.boot .home-hero > *,.hand.boot .home-paths > *,.hand.boot .more-games' && /animation:none/.test(r.body)));
});
test('reduced motion never gets html.hand, so nothing animates', () => {
  assert.match(html, /&&!matchMedia\("\(prefers-reduced-motion:reduce\)"\)\.matches\)d\.classList\.add\("hand"\)/);
});
