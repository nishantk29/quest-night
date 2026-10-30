// usage: node scripts/build-deploy.mjs <outFile>   (builds dist-embedded/worker.js itself, after the gate)
// Writes a Cloudflare-API deploy function file. Worker name, bindings (ROOM, AI, vars) and compatibility_date come from wrangler.jsonc only.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deployConfig, deployFunction } from './deploy-config.mjs';
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
const { name, metadata, workersDev } = deployConfig(fs.readFileSync('wrangler.jsonc', 'utf8'));
const W = fs.readFileSync('dist-embedded/worker.js', 'utf8');
const fn = deployFunction({ name, metadata, worker: W, workersDev });
try { fs.writeFileSync(out, fn); } catch (e) { fs.rmSync(out, { force: true }); throw e; } // never leave a half-written deploy file
console.log(out, fn.length, 'worker=' + name, 'bindings=' + metadata.bindings.map((b) => b.name).join(','), 'workers.dev=' + JSON.stringify(workersDev));
