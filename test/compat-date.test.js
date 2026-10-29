// Compatibility date bump 2025-09-01 -> 2026-10-01 (tech review, Oct 28 2026). Each flag that became default in between
// and touches what this Worker does is pinned here, so a later change that relies on the old behaviour fails the gate.
// Flags: https://developers.cloudflare.com/workers/configuration/compatibility-flags/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deployConfig, stripComments } from '../scripts/deploy-config.mjs';
const text = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const w = JSON.parse(stripComments(text));
const src = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');

test('the API upload carries the new date, and no flags (deployConfig does not send compatibility_flags)', () => {
  assert.equal(w.compatibility_date, '2026-10-01');
  assert.equal(deployConfig(text).metadata.compatibility_date, '2026-10-01');
  assert.equal(w.compatibility_flags, undefined);
});
test('websocket_close_reason_byte_limit (2026-03-03): every close reason is at most 123 bytes', () => {
  const reasons = [...src.matchAll(/\.close\(\d+,\s*'([^']*)'\)/g)].map((m) => m[1]);
  assert.ok(reasons.length > 0);
  for (const r of reasons) assert.ok(Buffer.byteLength(r) <= 123, r);
  assert.doesNotMatch(src, /\.close\(\d+,\s*[^'\s)]/, 'no computed close reasons');
});
test('web_socket_auto_reply_to_close (2026-04-07): the close() inside webSocketClose is harmless (ignored) and guarded', () => {
  assert.match(src, /async webSocketClose\(ws\) \{ try \{ ws\.close\(\); \} catch/);
});
test('delete_all_deletes_alarm (2026-02-24): closing a room deletes the alarm and then all data, nothing re-arms after', () => {
  const close = src.slice(src.indexOf('async closeRoom()'), src.indexOf('async webSocketClose('));
  assert.ok(close.includes('deleteAlarm()') && close.indexOf('deleteAlarm()') < close.indexOf('deleteAll()'));
  assert.doesNotMatch(close, /setAlarm/);
  assert.match(src, /async alarm\(\) \{ await this\.ctx\.storage\.deleteAll\(\); this\.room = null; \}/);
});
test('nodejs_compat on by default (2026-08-04) and enable_fast_jsg_struct (2025-12-03): the Worker never sniffs for Node or uses `in` on runtime objects', () => {
  assert.doesNotMatch(src, /typeof (process|Buffer|require|module)\b|\bprocess\.|\bBuffer\./);
  assert.doesNotMatch(src, /'[a-zA-Z]+' in (req|request|ws|resp|response|env|ctx)\b/);
});
