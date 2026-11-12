// The room socket reconnects as soon as the phone is back (tech review, Oct 28): app.js wires the shared wake kit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const app = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
// Optional: WAKE_KIT points at the shared reconnect kit's wake.js; the copy check is skipped when it is unset or missing.
const kit = process.env.WAKE_KIT || '';
const start = app.indexOf('function wsTransport');
const t = app.slice(start, app.indexOf('\nfunction ', start + 10));

test('wsTransport uses wakeReconnect, resets the backoff, and stops listening on close', () => {
  assert.match(app, /import \{ wakeReconnect \} from '\.\/wake\.js';/);
  assert.match(t, /wakeReconnect\(\{ getSocket: \(\) => ws, isStopped: \(\) => closed, reconnect: \(\) => \{ clearTimeout\(timer\); tries = 0; open\(\); \} \}\)/);
  assert.match(t, /close: \(\) => \{ closed = true; stopWake\(\);/);
  assert.match(t, /const s = ws = new WebSocket/);
  assert.match(t, /ws\.onclose = \(\) => \{ if \(closed \|\| s !== ws\) return;/, 'an abandoned socket cannot schedule a second reconnect');
});
test('public/js/wake.js is the shared kit, unchanged', { skip: !(() => { try { readFileSync(kit); return true; } catch { return false; } })() && 'shared kit not on this machine' }, () => {
  assert.equal(readFileSync(new URL('../public/js/wake.js', import.meta.url), 'utf8'), readFileSync(kit, 'utf8'));
});
