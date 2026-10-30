// The deploy file must leave the worker's workers.dev route and preview URLs exactly as wrangler.jsonc says, and
// wrangler.jsonc must say it explicitly. Nothing may default to on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deployConfig, deployFunction, workersDevOf, stripComments } from '../scripts/deploy-config.mjs';

const text = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const w = JSON.parse(stripComments(text));
// Live state, read with GET /accounts/{account}/workers/scripts/{name}/subdomain on Oct 30 2026, 3:10 AM ET.
// If you change workers_dev or preview_urls on purpose, re-read live and update this line in the same change.
const LIVE = { enabled: true, previews_enabled: false };
const gen = (cfgText) => workersDevOf(deployFunction({ ...deployConfig(cfgText), worker: 'export default {}' }));
const cfg = (extra) => `{"name":"x","compatibility_date":"2026-10-01"${extra}}`;

test('wrangler.jsonc sets workers_dev and preview_urls explicitly, to the live values', () => {
  assert.equal(typeof w.workers_dev, 'boolean', 'wrangler.jsonc must set "workers_dev"');
  assert.equal(typeof w.preview_urls, 'boolean', 'wrangler.jsonc must set "preview_urls"');
  assert.deepEqual({ enabled: w.workers_dev, previews_enabled: w.preview_urls }, LIVE);
});

test('the generated deploy posts exactly the workers.dev settings wrangler.jsonc declares', () => {
  assert.deepEqual(gen(text), { enabled: w.workers_dev, previews_enabled: w.preview_urls });
});

test('workers_dev false in the config never becomes enabled in the deploy', () => {
  assert.deepEqual(gen(cfg(',"workers_dev":false,"preview_urls":false')), { enabled: false, previews_enabled: false });
  assert.deepEqual(gen(cfg(',"workers_dev":false,"preview_urls":true')), { enabled: false, previews_enabled: true });
});

test('a config that leaves workers_dev or preview_urls unset produces no deploy', () => {
  assert.throws(() => gen(cfg('')), /workers_dev/);
  assert.throws(() => gen(cfg(',"workers_dev":false')), /preview_urls/);
  assert.throws(() => gen(cfg(',"workers_dev":"false","preview_urls":false')), /workers_dev/);
  assert.throws(() => deployFunction({ name: 'x', metadata: {}, worker: '' }), /workersDev/);
});
