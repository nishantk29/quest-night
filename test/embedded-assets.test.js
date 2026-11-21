// The asset server inside the embedded build (scripts/build-embedded.mjs): security headers, cache lifetimes, ETag + 304.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetServer, etagOf } from '../scripts/build-embedded.mjs';

const file = (t, text) => ({ t, b: Buffer.from(text).toString('base64'), e: etagOf(Buffer.from(text)) });
const FILES = {
  '/index.html': file('text/html; charset=utf-8', '<!doctype html>'), '/404.html': file('text/html; charset=utf-8', 'lost'),
  '/sw.js': file('application/javascript; charset=utf-8', 'sw'), '/js/app.js': file('application/javascript; charset=utf-8', 'app'),
  '/fonts/rubik-var.woff2': file('font/woff2', 'font'), '/icons/icon-512.png': file('image/png', 'png'),
};
const A = assetServer(FILES);
const get = (p, headers = {}) => A.fetch(new Request('https://x.test' + p, { headers }));
const SECURITY = [['strict-transport-security', 'max-age=31536000'], ['x-content-type-options', 'nosniff'],
  ['referrer-policy', 'strict-origin-when-cross-origin'], ['content-security-policy', "frame-ancestors 'none'"]];
const hasSecurity = (res, what) => { for (const [k, v] of SECURITY) assert.equal(res.headers.get(k), v, `${what}: ${k}`); };

test('every asset response, the 404 page and a 304 carry the security headers', async () => {
  for (const p of ['/', '/js/app.js', '/fonts/rubik-var.woff2', '/sw.js']) hasSecurity(await get(p), p);
  const miss = await get('/nope');
  assert.equal(miss.status, 404); assert.equal(await miss.text(), 'lost'); hasSecurity(miss, '404');
  hasSecurity(await get('/js/app.js', { 'if-none-match': FILES['/js/app.js'].e }), '304');
});

test('cache lifetimes: HTML and sw.js revalidate, fonts and icons a year (not immutable), the rest an hour', async () => {
  assert.equal((await get('/')).headers.get('cache-control'), 'no-cache');
  assert.equal((await get('/sw.js')).headers.get('cache-control'), 'no-cache');
  for (const p of ['/fonts/rubik-var.woff2', '/icons/icon-512.png']) assert.equal((await get(p)).headers.get('cache-control'), 'public, max-age=31536000', p);
  assert.equal((await get('/js/app.js')).headers.get('cache-control'), 'public, max-age=3600');
});

test('ETag is a content hash; If-None-Match that matches is a 304 with no body, anything else the full file', async () => {
  const res = await get('/js/app.js');
  assert.equal(res.headers.get('etag'), etagOf(Buffer.from('app'))); assert.match(res.headers.get('etag'), /^"[0-9a-f]{16}"$/);
  assert.equal(await res.text(), 'app');
  assert.notEqual(FILES['/js/app.js'].e, FILES['/sw.js'].e);
  for (const inm of [FILES['/js/app.js'].e, `W/${FILES['/js/app.js'].e}`, `"zzz", ${FILES['/js/app.js'].e}`, '*']) {
    const r = await get('/js/app.js', { 'if-none-match': inm });
    assert.equal(r.status, 304, inm); assert.equal(await r.text(), ''); assert.equal(r.headers.get('etag'), FILES['/js/app.js'].e);
  }
  const stale = await get('/js/app.js', { 'if-none-match': FILES['/sw.js'].e });
  assert.equal(stale.status, 200); assert.equal(await stale.text(), 'app');
  assert.equal((await get('/', { 'if-none-match': FILES['/index.html'].e })).status, 304, 'HTML revalidates to a 304 too');
});

test('secure() adds the headers to worker responses (error pages, API) and leaves a WebSocket upgrade alone', async () => {
  const page = A.secure(new Response('<p>gone</p>', { status: 410, headers: { 'content-type': 'text/html', 'cache-control': 'no-store' } }));
  assert.equal(page.status, 410); assert.equal(page.headers.get('cache-control'), 'no-store'); assert.equal(await page.text(), '<p>gone</p>');
  hasSecurity(page, 'error page');
  const ws = { status: 101, webSocket: {} };
  assert.equal(A.secure(ws), ws);
});
