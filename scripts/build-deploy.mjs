// usage: node scripts/build-deploy.mjs <outFile>   (builds dist-embedded/worker.js itself, after the gate)
// Writes a Cloudflare-API deploy function file. Worker name, DO bindings and compatibility_date come from wrangler.jsonc only.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deployConfig } from './deploy-config.mjs';
import { computeVersion, swVersion, FIX_HINT } from './sw-version.mjs';
import { runGate } from './test-gate.mjs';

const out = process.argv[2];
if (!out) { console.error('usage: node scripts/build-deploy.mjs <outFile>'); process.exit(1); }
// The test gate runs before anything is written, and there is no flag to skip it: a red suite never produces a deploy file.
const gate = await runGate({ cwd: process.cwd() });
if (!gate.ok) {
  console.error(`Deploy file NOT written: ${gate.fail} test(s) failed`); process.exit(1);
}
if (swVersion() !== computeVersion()) { console.error('public/sw.js VERSION is stale (public/ changed since make-pwa); installed PWAs would keep old files.\n' + FIX_HINT); process.exit(1); }
const be = spawnSync(process.execPath, [fileURLToPath(new URL('./build-embedded.mjs', import.meta.url))], { stdio: 'inherit' });
if (be.status !== 0) { console.error('build-embedded failed; deploy file NOT written'); process.exit(1); }
const { name, metadata } = deployConfig(fs.readFileSync('wrangler.jsonc', 'utf8'));
const W = fs.readFileSync('dist-embedded/worker.js', 'utf8');
const fn = `async () => { const ACC="a3303cef4b0984b2859ef104bd74df1e"; const NAME=${JSON.stringify(name)}; const WORKER=${JSON.stringify(W)};
 const metadata = ${JSON.stringify(metadata)};
 const B = '----cn' + Date.now();
 const body = ['--' + B, 'Content-Disposition: form-data; name="metadata"', 'Content-Type: application/json', '', JSON.stringify(metadata),
   '--' + B, 'Content-Disposition: form-data; name="worker.js"; filename="worker.js"', 'Content-Type: application/javascript+module', '', WORKER, '--' + B + '--', ''].join('\\r\\n');
 const put = await cloudflare.request({ method: 'PUT', path: '/accounts/' + ACC + '/workers/scripts/' + NAME, body, contentType: 'multipart/form-data; boundary=' + B, rawBody: true });
 const sub = await cloudflare.request({ method: 'POST', path: '/accounts/' + ACC + '/workers/scripts/' + NAME + '/subdomain', body: { enabled: true, previews_enabled: false } });
 return { script: put.success, errors: put.errors, etag: put.result && put.result.etag, subdomain: sub.success };
}`;
try { fs.writeFileSync(out, fn); } catch (e) { fs.rmSync(out, { force: true }); throw e; } // never leave a half-written deploy file
console.log(out, fn.length, 'worker=' + name);
