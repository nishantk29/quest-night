// Every broken page is a styled page with two ways out and no raw error text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(s, c, n) { return s === 'cloudflare:workers' ? { url: 'data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}', shortCircuit: true } : n(s, c); }`), import.meta.url);
const worker = (await import('../src/worker.js')).default;
const { errorPage } = await import('../src/error-page.js');
const { errorBody, crashHtml, FATAL, ENDED } = await import('../public/js/error-screen.js');

const HUB = 'https://gamenight.hatethespurs.com';
const clean = (html) => { assert.doesNotMatch(html, /Error:|\n\s+at |TypeError|stack|undefined|\[object/); };
const twoLinks = (html) => { assert.ok(html.includes(`href="${HUB}"`)); assert.ok(html.includes('href="/"')); assert.match(html, /Go to Game Night home/); assert.match(html, /Back to Quest Night home/); assert.match(html, /class="err-link" href="\/"/); };
const env = (over = {}) => ({ ASSETS: { fetch: async () => new Response('nope', { status: 404 }) }, ROOM: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response(null, { status: 404 }) }) }, ...over });
const req = (path, init) => new Request('https://x.test' + path, init);

test('unknown path: styled 404 with both links', async () => {
  const res = await worker.fetch(req('/nope/nothing'), env());
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text(); twoLinks(html); clean(html);
});
test('unknown /api route: HTML for browsers, JSON for API callers', async () => {
  const b = await worker.fetch(req('/api/zzz', { headers: { accept: 'text/html' } }), env());
  assert.equal(b.status, 404); assert.match(b.headers.get('content-type'), /html/);
  const j = await worker.fetch(req('/api/zzz'), env());
  assert.equal(j.status, 404); assert.match(j.headers.get('content-type'), /json/);
  const r = await worker.fetch(req('/api/room/ZZZZZZ'), env());
  assert.equal(r.status, 404); assert.deepEqual(await r.json(), { exists: false });
});
test('/ws/ without an upgrade: styled 426', async () => {
  const res = await worker.fetch(req('/ws/ABCDEF'), env());
  assert.equal(res.status, 426); twoLinks(await res.text());
});
test('a thrown error becomes a styled 500 with no stack', async () => {
  const origErr = console.error; const logged = []; console.error = (...a) => logged.push(a);
  try {
    const boom = env({ ROOM: { idFromName: () => 'x', get: () => { throw new Error('SECRET boom'); } } });
    const res = await worker.fetch(req('/api/room/ABCDEF', { headers: { accept: 'text/html' } }), boom);
    assert.equal(res.status, 500);
    const html = await res.text(); twoLinks(html); clean(html); assert.doesNotMatch(html, /SECRET|boom/);
    assert.equal(logged.length, 1);
    const api = await worker.fetch(req('/api/create', { method: 'POST' }), boom);
    assert.equal(api.status, 500); assert.match(api.headers.get('content-type'), /json/); assert.doesNotMatch(await api.text(), /SECRET/);
  } finally { console.error = origErr; }
});
test('found assets pass through untouched', async () => {
  const res = await worker.fetch(req('/styles.css'), env({ ASSETS: { fetch: async () => new Response('body{}', { status: 200 }) } }));
  assert.equal(res.status, 200); assert.equal(await res.text(), 'body{}');
});
test('embedded ASSETS serves the 404 page for a missing file', () => {
  const src = fs.readFileSync(new URL('../scripts/build-embedded.mjs', import.meta.url), 'utf8');
  assert.match(src, /if \(!f\) return new Response\(bytes\(FILES\['\/404\.html'\]\.b\), \{ status: 404/);
  assert.doesNotMatch(src, /new Response\('Not found'/);
});
test('wrangler serves the 404 page for unknown assets', () => assert.match(fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'), /"not_found_handling": "404-page"/));
test('public/404.html is in sync with the template', () => assert.equal(fs.readFileSync(new URL('../public/404.html', import.meta.url), 'utf8'), errorPage({ status: 404 })));
test('404 copy: shadows title, sentence-case Rubik title class', () => {
  const h = errorPage({ status: 404 });
  assert.match(h, /<title>This page slipped into the shadows · Quest Night<\/title>/);
  assert.match(h, /<h1 class="err-title">This page slipped into the shadows<\/h1>/);
  assert.match(h, /The page you wanted isn’t here\. Head back to the games\./);
  const css = fs.readFileSync(new URL('../public/redesign.css', import.meta.url), 'utf8');
  assert.match(css, /\.err-title\{font-family:var\(--display-serif\);[^}]*text-transform:none/);
});
test('404.html is self-contained: works with JS off', () => { const h = errorPage({ status: 404 }); assert.doesNotMatch(h, /<script/); assert.match(h, /styles\.css/); });

test('client error screens: bad code, expired, ended, closed all carry both buttons', () => {
  const all = [FATAL.noRoom('ZZZZZZ'), FATAL.closed, FATAL.gone, ENDED.host];
  for (const e of all) { const h = errorBody(e); twoLinks(h); clean(h); assert.match(h, /btn big/); assert.match(h, /err-link/); assert.match(h, /<h1 class="err-title">/); assert.doesNotMatch(h, /phase-title|btn ghost/); }
  assert.match(errorBody(FATAL.noRoom('ZZZZZZ')), /no table with the code ZZZZZZ/);
});
test('error text is escaped', () => assert.doesNotMatch(errorBody({ title: '<img onerror=1>', line: '<b>' }), /<img|<b>/));
test('crash handler output never includes the error message or stack', () => {
  const h = crashHtml(); twoLinks(h); clean(h);
  const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /\$app\.innerHTML = crashHtml\(\)/);
  assert.doesNotMatch(app.slice(app.indexOf('function crash(')).split('\n').slice(0, 4).join('\n'), /innerHTML = .*(e\.message|e\.stack|String\(e\))/);
  assert.match(app, /addEventListener\('error'/); assert.match(app, /addEventListener\('unhandledrejection'/);
  assert.match(app, /try \{ \$app\.innerHTML = screen\(\); \} catch/);
});

test('long disconnect keeps the banner and adds both home buttons; labels never wrap', () => {
  const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /banner-lost' : ''\}" role="status">.*Reconnecting… Your seat and role are kept\.\$\{S\.connLong \? errorButtons\(\) : ''\}/);
  assert.match(app, /setTimeout\(\(\) => \{ if \(!S\.conn && !closed\) \{ S\.connLong = true; render\(\); \} \}, 20000\)/);
  const css = fs.readFileSync(new URL('../public/redesign.css', import.meta.url), 'utf8');
  assert.match(css, /\.err-actions \.btn\{[^}]*white-space:nowrap/);
});
test('error page motion is scaled and gated for reduced motion', () => {
  const h = errorPage({ status: 404 });
  assert.match(h, /prefers-reduced-motion:no-preference/); assert.match(h, /calc\(\.5s \* var\(--dur-scale\)\)/);
});
test('service worker precaches the error screen module and 404 page', () => {
  const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /'\/js\/error-screen\.js'/); assert.match(sw, /'\/404\.html'/);
});
