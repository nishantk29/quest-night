// Local dev and e2e run with no Cloudflare login: every `wrangler dev` this repo starts passes `--local`, which turns
// off remote bindings, so the remote-only Workers AI binding is not connected and no API token is needed (Wrangler 4.151
// docs: "When using wrangler dev, you can temporarily disable all remote bindings ... by providing the --local flag").
// wrangler.jsonc stays the single source of truth: no dev copy, no dev env, and the deploy keeps the AI binding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deployConfig, deployFunction, metadataOf, stripComments } from '../scripts/deploy-config.mjs';
import { runText } from '../src/ai.js';
import { fakeEnv, fakeAI } from './ai-fakes.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const text = fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8');
const w = JSON.parse(stripComments(text));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('deploy config keeps the Workers AI binding (local dev must not remove it from wrangler.jsonc)', () => {
  assert.equal(w.ai?.binding, 'AI', 'wrangler.jsonc lost "ai": { "binding": "AI" }');
  const md = metadataOf(deployFunction({ ...deployConfig(text), worker: 'export default {}' }));
  assert.ok(md.bindings.some((b) => b.type === 'ai' && b.name === 'AI'), 'generated deploy metadata has no AI binding');
  if (pkg.scripts.deploy) assert.doesNotMatch(pkg.scripts.deploy, /--local|--config|--env|-e\s/, 'npm run deploy must use the main config');
});

test('one wrangler config: no dev/test copy and no env block that could drift from the deployed bindings', () => {
  const copies = fs.readdirSync(root).filter((f) => /^wrangler\..*\.(jsonc?|toml)$/.test(f) || f === 'wrangler.toml' || f === 'wrangler.json');
  assert.deepEqual(copies, [], 'extra wrangler config files: dev and e2e must read wrangler.jsonc with --local');
  assert.equal(w.env, undefined, 'wrangler.jsonc has an "env" block; local runs use --local on the main config instead');
  assert.equal(w.ai?.remote, undefined, '"remote" on the ai binding changes how dev connects; leave it unset (false is an error)');
});

// Every place in the repo that starts `wrangler dev`: npm scripts and the e2e harness spawn.
function devStarts() {
  const out = [];
  for (const [k, v] of Object.entries(pkg.scripts || {})) if (/\bwrangler\s+dev\b/.test(v)) out.push({ where: `package.json scripts.${k}`, local: /(^|\s)--local(\s|$)/.test(v) });
  const dirs = ['test/e2e', 'scripts', 'tools'].map((d) => path.join(root, d)).filter((d) => fs.existsSync(d));
  for (const d of dirs) for (const f of fs.readdirSync(d)) {
    if (!/\.(m?js|sh)$/.test(f)) continue;
    const src = fs.readFileSync(path.join(d, f), 'utf8');
    for (const m of src.matchAll(/spawn\w*\(\s*[^,]*wrangler[^,]*,\s*\[([^\]]*)\]|spawn\w*\(\s*bin\s*,\s*\[([^\]]*)\]/g)) {
      const args = m[1] ?? m[2];
      if (/['"]dev['"]/.test(args)) out.push({ where: `${path.relative(root, d)}/${f}`, local: /['"]--local['"]/.test(args) });
    }
  }
  return out;
}

test('every wrangler dev the repo starts (npm run dev, e2e harness) passes --local, so it needs no Cloudflare login', () => {
  const starts = devStarts();
  assert.ok(starts.some((s) => s.where === 'package.json scripts.dev'), 'npm run dev should start wrangler dev');
  assert.ok(starts.some((s) => s.where === 'test/e2e/phones.mjs'), 'the e2e harness spawn was not found; update this test with it');
  const remote = starts.filter((s) => !s.local).map((s) => s.where);
  assert.deepEqual(remote, [], `wrangler dev without --local (needs a Cloudflare token for the AI binding): ${remote.join(', ')}`);
});

test('the Worker tolerates env.AI being undefined (what wrangler dev --local gives it), even with AI_MODE on', async () => {
  const msgs = [{ role: 'user', content: 'Can a tie pass?' }];
  for (const mode of ['on', 'dark', 'off']) {
    const { env, touched } = fakeEnv({ mode });
    delete env.AI;
    assert.equal(await runText(env, { site: 'mafia', messages: msgs }), null, `mode ${mode}`);
    assert.equal(touched.length, 0, `budget or cache touched with no AI binding (mode ${mode})`);
  }
  const ai = fakeAI(); const { env } = fakeEnv({ mode: 'dark', ai });
  assert.equal(await runText(env, { site: 'mafia', messages: msgs }), null);
  assert.equal(ai.calls.length, 0, 'dark (the local AI_MODE) must never call the model');
});
