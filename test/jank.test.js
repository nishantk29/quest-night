// Jank fixes (Oct 29 2026, Nishant: "The way some elements appear are very janky"): short entrances on opacity and
// transform only, one slide per screen (the room's first view does not slide a second time), one divider token.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const pub = new URL('../public/', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, pub), 'utf8');
const CSS = fs.readdirSync(pub).filter((f) => f.endsWith('.css') && f !== 'print.css');

test('entrance timing is --t-enter: 180ms (x --dur-scale 1)', () => {
  assert.match(read('styles.css'), /--t-enter:calc\(180ms \* var\(--dur-scale\)\)/);
  assert.match(read('redesign.css'), /::view-transition-new\(step\)\{animation:\w+-step-in var\(--t-enter\)/);
  assert.match(read('redesign.css'), /\.boot [^{]*\{animation:\w+-rise var\(--t-enter\)/);
});

test('no keyframes animate layout properties', () => {
  const bad = /\b(height|width|top|left|right|bottom|margin[\w-]*|padding[\w-]*|max-height|min-height|inset|font-size|line-height|gap)\s*:/;
  for (const f of CSS) for (const m of read(f).matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g)) assert.ok(!bad.test(m[2]), `${f} @keyframes ${m[1]}`);
});

test('the first room view over the connecting placeholder does not start a second slide', () => {
  assert.match(read('js/app.js'), /const settling = lastKey !== null && /);
  assert.match(read('js/app.js'), /!settling/);
});

test('partitions use the divider tokens and whole-pixel borders', () => {
  assert.ok((read('styles.css').match(/--divider:var\(--rule\);--divider-strong:var\(--rule-strong\);/g) || []).length >= 2);
  for (const f of CSS) {
    const c = read(f);
    assert.doesNotMatch(c, /border(-top|-bottom|-left|-right)?(-color)?:\s*(\d+px solid )?var\(--rule\)[;}]/, f);
    if (!(f === 'setup.css' && /gs-/.test(c))) assert.doesNotMatch(c, /border[\w-]*:\s*(0?\.5|1\.5)px/, f);
  }
});
