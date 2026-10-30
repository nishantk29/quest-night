// Every binding wrangler.jsonc declares must reach the deploy file's metadata (the Cloudflare API upload), or the live
// worker runs without it (e.g. env.AI undefined). ASSETS is the one exception: the embedded build supplies it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deployConfig, deployFunction, metadataOf, stripComments } from '../scripts/deploy-config.mjs';

const text = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const w = JSON.parse(stripComments(text));

// Read independently of deploy-config.mjs: every name wrangler.jsonc binds.
function declared(cfg) {
  const names = [];
  for (const b of (cfg.durable_objects && cfg.durable_objects.bindings) || []) names.push(b.name);
  if (cfg.ai) names.push(cfg.ai.binding);
  names.push(...Object.keys(cfg.vars || {}));
  for (const [k, v] of Object.entries(cfg)) if (Array.isArray(v) && k !== 'migrations' && k !== 'routes' && k !== 'compatibility_flags') for (const b of v) if (b && (b.binding || b.name)) names.push(b.binding || b.name);
  return [...new Set(names)];
}
const generated = metadataOf(deployFunction({ ...deployConfig(text), worker: 'export default {}' }));

test('every binding declared in wrangler.jsonc is in the generated deploy metadata', () => {
  const have = generated.bindings.map((b) => b.name);
  const missing = declared(w).filter((n) => !have.includes(n));
  assert.deepEqual(missing, [], `declared in wrangler.jsonc but missing from the deploy file: ${missing.join(', ')}`);
});

test('the deploy metadata carries exactly ROOM, AI and AI_MODE as declared (same as run/tools/mk-existing-worker-deploy.mjs)', () => {
  const want = [{ type: 'durable_object_namespace', name: 'ROOM', class_name: 'Room' }];
  if (w.ai) want.push({ type: 'ai', name: 'AI' });
  if (w.vars && w.vars.AI_MODE !== undefined) want.push({ type: 'plain_text', name: 'AI_MODE', text: w.vars.AI_MODE });
  assert.deepEqual(generated.bindings, want);
  assert.equal(generated.compatibility_date, w.compatibility_date);
  assert.equal(generated.migrations, undefined);
});

test('the assets binding is supplied by the embedded build instead of the upload', () => {
  if (!w.assets) return;
  const be = fs.readFileSync(new URL('../scripts/build-embedded.mjs', import.meta.url), 'utf8');
  assert.match(be, new RegExp(`Object\\.assign\\(Object\\.create\\(env\\), \\{[^}]*\\b${w.assets.binding}\\b`));
  assert.ok(!generated.bindings.some((b) => b.name === w.assets.binding));
});

test('deployConfig uploads ai and vars, and refuses binding kinds it does not know', () => {
  const base = '"name":"x","compatibility_date":"2026-10-01","durable_objects":{"bindings":[{"name":"ROOM","class_name":"Room"}]}';
  const c = deployConfig(`{${base},"ai":{"binding":"AI"},"vars":{"AI_MODE":"on","GREETING":"hi"}}`);
  assert.deepEqual(c.metadata.bindings.map((b) => [b.type, b.name]), [['durable_object_namespace', 'ROOM'], ['ai', 'AI'], ['plain_text', 'AI_MODE'], ['plain_text', 'GREETING']]);
  assert.throws(() => deployConfig(`{${base},"kv_namespaces":[{"binding":"KV","id":"1"}]}`), /kv_namespaces/);
  assert.throws(() => deployConfig(`{${base},"vars":{"AI_MODE":"loud"}}`), /AI_MODE/);
  assert.throws(() => deployConfig(`{${base},"ai":{}}`), /binding/);
});

test('build-deploy.mjs writes the metadata from deployConfig through deployFunction', () => {
  const src = fs.readFileSync(new URL('../scripts/build-deploy.mjs', import.meta.url), 'utf8');
  assert.match(src, /deployConfig\(fs\.readFileSync\('wrangler\.jsonc'/);
  assert.match(src, /deployFunction\(\{ name, metadata, worker: W \}\)/);
  assert.ok(!/const metadata = \$\{/.test(src), 'build-deploy.mjs must not build its own metadata');
});
