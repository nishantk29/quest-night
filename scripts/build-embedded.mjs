// Builds dist-embedded/worker.js: the Worker with every file in public/ inlined, for deploying through the
// Cloudflare API without the assets-upload step (used when wrangler has no token on this machine).
// `wrangler deploy` (npm run deploy) is still the normal path and uses real Workers Static Assets.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// The asset server inside the embedded worker. A real function so test/embedded-assets.test.js can run it; the build
// inlines its source into dist-embedded/entry.js. FILES maps a path to { t: content type, b: base64 bytes, e: ETag }.
// HTML and sw.js revalidate every time; fonts and icons keep a year (not immutable: their names carry no content hash,
// so a changed file is picked up on reload through the ETag); everything else an hour. An If-None-Match hit is a 304.
export function assetServer(FILES) {
  const TYPES_HTML = 'text/html; charset=utf-8';
  // No full CSP yet: the inline scripts in index.html would need hashes first. frame-ancestors only stops framing.
  const SECURITY = { 'strict-transport-security': 'max-age=31536000', 'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin', 'content-security-policy': "frame-ancestors 'none'" };
  const bytes = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
  const matches = (inm, etag) => !!inm && inm.split(',').some((t) => { t = t.trim(); return t === '*' || t.replace(/^W\//, '') === etag; });
  return {
    async fetch(req) {
      const url = new URL(req.url);
      let p = url.pathname === '/' ? '/index.html' : url.pathname;
      const f = FILES[p];
      if (!f) return new Response(bytes(FILES['/404.html'].b), { status: 404, headers: { 'content-type': TYPES_HTML, 'cache-control': 'no-store', ...SECURITY } });
      const cache = p === '/index.html' || p === '/sw.js' ? 'no-cache' : /^\/(fonts|icons)\//.test(p) ? 'public, max-age=31536000' : 'public, max-age=3600';
      const headers = { 'content-type': f.t, 'cache-control': cache, etag: f.e, ...SECURITY };
      if (matches(req.headers.get('if-none-match'), f.e)) return new Response(null, { status: 304, headers });
      return new Response(bytes(f.b), { headers });
    },
    // Every response the worker sends (error pages and API included) gets the same headers; a WebSocket upgrade is left alone.
    secure(res) {
      if (res.status === 101) return res;
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(SECURITY)) out.headers.set(k, v);
      return out;
    },
  };
}

const TYPES = { js: 'application/javascript; charset=utf-8', css: 'text/css; charset=utf-8', html: 'text/html; charset=utf-8', png: 'image/png',
  svg: 'image/svg+xml', woff2: 'font/woff2', webmanifest: 'application/manifest+json' };
export const etagOf = (buf) => `"${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)}"`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = {};
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else files['/' + path.relative('public', p).split(path.sep).join('/')] = p; } };
  walk('public');
  const map = Object.fromEntries(Object.entries(files).map(([u, p]) => { const buf = fs.readFileSync(p); return [u, { t: TYPES[path.extname(p).slice(1)] || 'application/octet-stream', b: buf.toString('base64'), e: etagOf(buf) }]; }));
  fs.mkdirSync('dist-embedded', { recursive: true });
  fs.writeFileSync('dist-embedded/entry.js', `import worker, { Room } from '../src/worker.js';
const FILES = ${JSON.stringify(map)};
${assetServer.toString()}
const ASSETS = assetServer(FILES);
export default { fetch: async (req, env, ctx) => ASSETS.secure(await worker.fetch(req, Object.assign(Object.create(env), { ROOM: env.ROOM, ASSETS }), ctx)) };
export { Room };
`);
  await build({ entryPoints: ['dist-embedded/entry.js'], bundle: true, format: 'esm', outfile: 'dist-embedded/worker.js', external: ['cloudflare:workers'], target: 'es2022', logLevel: 'warning' });
  console.log('dist-embedded/worker.js', fs.statSync('dist-embedded/worker.js').size, 'bytes,', Object.keys(map).length, 'files');
}
