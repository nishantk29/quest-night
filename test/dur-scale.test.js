import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const pub = new URL('../public/', import.meta.url);
const read = (f) => readFileSync(new URL(f, pub), 'utf8');
const css = ['fx.css', 'motion.css', 'redesign.css', 'styles.css', 'theme.css', 'print.css'].map((f) => [f, read(f)]);
const html = read('index.html');
css.push(['index.html <style>', [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')]);

// Drop comments and the allowlisted blocks (reduced-motion, fx-off).
function stripAllowed(src) {
  src = src.replace(/\/\*[\s\S]*?\*\//g, '');
  let out = '', i = 0;
  while (i < src.length) {
    const m = /@media[^{]*prefers-reduced-motion[^{]*\{|[^{}]*\bfx-off\b[^{]*\{/.exec(src.slice(i));
    if (!m) { out += src.slice(i); break; }
    out += src.slice(i, i + m.index);
    let j = i + m.index + m[0].length, d = 1;
    while (j < src.length && d) { if (src[j] === '{') d++; else if (src[j] === '}') d--; j++; }
    i = j;
  }
  return out;
}

const TIME = /(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g;
const DECL = /(transition|animation)[\w-]*\s*:[^;}]*|--t-[\w-]+\s*:[^;}]*/g;
function offenders(src) {
  const bad = [];
  for (const d of src.match(DECL) || []) {
    if (/\bqn-(twinkle|flutter|pennant)\b/.test(d)) continue; // the ambient sky, flag and pennant keep their period (they play once now: test/play-once.test.js)
    // literal not followed by "* var(--dur-scale)" and not inside a scaled group
    const flat = d.replace(/calc\(\s*\((?:[^()]|\([^()]*\))*\)\s*\*\s*var\(--dur-scale\)\)/g, '').replace(/calc\(\s*[\d.]+m?s\s*\*\s*var\(--dur-scale\)\)/g, '');
    for (const m of flat.matchAll(TIME)) if (parseFloat(m[1]) !== 0) bad.push(d.trim());
  }
  return [...new Set(bad)];
}

test('root --dur-scale is 1 (the 2x slow-motion ask was replaced by the 400ms budget, 2026-10-29)', () => {
  assert.match(read('styles.css'), /:root\s*\{[^}]*--dur-scale:\s*1\b/);
});

for (const [name, src] of css) {
  test(`no unscaled duration/delay in ${name}`, () => {
    assert.deepEqual(offenders(stripAllowed(src)), []);
  });
}

test('JS animation timings go through dur()', () => {
  for (const f of readdirSync(new URL('js/', pub)).filter((n) => n.endsWith('.js'))) {
    const src = read(`js/${f}`);
    for (const m of src.matchAll(/(?:transition|animation)[\w-]*\s*:[^;'"`}]*/g)) assert.doesNotMatch(m[0], TIME, `${f}: ${m[0]}`);
    for (const m of src.matchAll(/duration:\s*([^,}]+)/g)) assert.match(m[1], /dur\(/, `${f}: duration ${m[1]}`);
  }
  assert.doesNotMatch(html, /duration:\d/); // the old 450 ms hub FLIP is gone (test/hub-arrival.test.js)
});
