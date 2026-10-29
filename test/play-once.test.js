// Nishant, Oct 28 11:09 PM ET: the looping decorations play ONCE and stop on their final frame; with reduced motion the
// final frame shows with no motion. Nothing in Quest Night's CSS, HTML or JS loops forever.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const pub = new URL('../public/', import.meta.url);
const rd = (f) => readFileSync(new URL(f, pub), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const css = readdirSync(pub).filter((f) => f.endsWith('.css')).map((f) => [f, strip(rd(f))]);
const js = readdirSync(new URL('js/', pub)).filter((f) => f.endsWith('.js')).map((f) => [`js/${f}`, rd(`js/${f}`)]);
const all = [...css, ['index.html', rd('index.html')], ...js, ...readdirSync(pub).filter((f) => f.endsWith('.js')).map((f) => [f, rd(f)])];

test('no infinite or repeating animation anywhere (CSS, inline styles, JS)', () => {
  for (const [f, src] of all) {
    assert.doesNotMatch(src, /\binfinite\b/, f);
    assert.doesNotMatch(src, /animation-iteration-count\s*:\s*(?!1\b)/, f);
    assert.doesNotMatch(src, /iterations\s*:\s*(Infinity|[2-9]|\d{2,})/, f);
  }
});
const keyframes = (name) => strip(rd('redesign.css')).match(new RegExp(`@keyframes ${name}\\{((?:[^{}]|\\{[^{}]*\\})*)\\}`))[1];
const decl = (sel) => strip(rd('redesign.css')).match(new RegExp(`(?:^|[}\\n])${sel.replace(/[.]/g, '\\.')}\\{([^}]*)\\}`))[1];
test('twinkle, flutter and pennant each run once', () => {
  assert.match(decl('.bg-stars'), /animation:qn-twinkle 6s var\(--qn-ease\) 1 both/);
  assert.match(decl('.bg-win'), /animation:qn-twinkle calc\(7s \* var\(--dur-scale\)\) ease-in-out 1 both/);
  assert.match(decl('.flag-cloth'), /animation:qn-flutter 7s var\(--qn-ease\) 1\b/);
  assert.match(decl('.pennant'), /animation:qn-pennant 5s var\(--qn-ease\) 1\b/);
});
test('the final frame is the resting pose, so reduced motion (animation:none) shows the same final frame', () => {
  assert.match(keyframes('qn-twinkle'), /to\{opacity:1\}/); // stars and windows end fully lit (their resting opacity is 1)
  assert.match(keyframes('qn-flutter'), /0%,56%,100%\{transform:none\}/); // the flag ends hanging still
  assert.match(keyframes('qn-pennant'), /0%,30%,100%\{transform:none\}/); // the pennant ends hanging still
  const s = strip(rd('redesign.css'));
  assert.match(s, /@media \(prefers-reduced-motion:reduce\)\{[^@]*\.bg-stars,\.bg-win,\.flag-cloth[^{]*\{animation:none!important\}/);
  assert.match(s, /@media \(prefers-reduced-motion:reduce\)\{\.pennant\{animation:none!important\}\}/);
});
