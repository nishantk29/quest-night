// index.html head (modulepreload for the whole app.js import graph, share-preview tags), the footer's game links,
// the Tools pill and the credits links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rd = (f) => fs.readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const html = rd('index.html');
const css = rd('redesign.css').replace(/\/\*[\s\S]*?\*\//g, '');

// Static imports reachable from app.js (`import ... from './x.js'`, `export ... from`, bare `import './x.js'`).
function graph(entry = 'app.js', seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const src = rd('js/' + entry);
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*['"]\.\/([^'"]+)['"]/g)) graph(m[1], seen);
  for (const m of src.matchAll(/(?:^|\n)\s*import\s*['"]\.\/([^'"]+)['"]/g)) graph(m[1], seen);
  return seen;
}

test('index.html modulepreloads exactly the modules app.js imports (no more, no fewer)', () => {
  const want = [...graph()].map((f) => '/js/' + f).sort();
  const have = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]);
  assert.ok(want.length > 20, 'the walk found the graph');
  assert.equal(new Set(have).size, have.length, 'no duplicates');
  assert.deepEqual([...have].sort(), want);
  for (const p of have) assert.ok(fs.existsSync(new URL(`../public${p}`, import.meta.url)), p);
  assert.ok(html.indexOf('rel="modulepreload"') < html.indexOf('</head>'), 'in the head');
});

test('share preview: og:title, og:description and og:image (the 512 icon, absolute https URL)', () => {
  const og = (p) => (new RegExp(`<meta property="og:${p}" content="([^"]+)">`).exec(html) || [])[1];
  assert.equal(og('title'), 'Quest Night');
  assert.equal(og('description'), /<meta name="description" content="([^"]+)">/.exec(html)[1]);
  assert.equal(og('image'), 'https://avalon.hatethespurs.com/icons/icon-512.png');
  assert.ok(fs.existsSync(new URL('../public/icons/icon-512.png', import.meta.url)));
});

test('footer links every Game Night game, Brass Wallet and The Odd Card included', () => {
  const foot = /function siteFooter\(\) \{[\s\S]*?\n\}/.exec(rd('js/app.js'))[0];
  for (const [href, name] of [['https://mafia.hatethespurs.com', 'Mafia Night'], ['https://gilded.hatethespurs.com', 'The Gilded Chamber'],
    ['https://brass.hatethespurs.com', 'Brass Wallet'], ['https://oddcard.hatethespurs.com', 'The Odd Card']]) assert.ok(foot.includes(`<a href="${href}">${name}</a>`), name);
});

test('Tools pill: 48px tall, weight 700, press scale only without reduced motion', () => {
  const rule = /\.tabbar \.more-pill\{([^}]*)\}/.exec(css)[1];
  assert.match(rule, /min-height:48px/); assert.match(rule, /font-weight:700/);
  const presses = [...css.matchAll(/([^{}]*)\{\.tabbar \.more-pill:active\{[^}]*scale/g)];
  assert.equal(presses.length, 1); assert.match(presses[0][1], /@media \(prefers-reduced-motion:no-preference\)\s*$/);
  assert.doesNotMatch(css.replace(/@media \(prefers-reduced-motion:no-preference\)\{\.tabbar \.more-pill:active\{[^}]*\}\}/, ''), /\.more-pill:active/);
});

test('credit links are 44px tall tap targets', () => {
  assert.match(css, /\.credits-box a\{[^}]*display:inline-flex[^}]*align-items:center[^}]*min-height:44px/);
});
