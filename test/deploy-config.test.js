import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deployConfig, stripComments } from '../scripts/deploy-config.mjs';

const text = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const w = JSON.parse(stripComments(text));

test('worker name is the live script name, not the repo name', () => assert.equal(w.name, 'quest-night'));
test('ROOM durable object binding -> Room', () => assert.deepEqual(w.durable_objects.bindings, [{ name: 'ROOM', class_name: 'Room' }]));
test('migrations: only v1 new_sqlite_classes [Room]', () => {
  assert.deepEqual(w.migrations, [{ tag: 'v1', new_sqlite_classes: ['Room'] }]);
  for (const m of w.migrations) for (const k of ['deleted_classes', 'renamed_classes', 'new_classes', 'transferred_classes']) assert.equal(m[k], undefined);
});
test('src/worker.js exports class Room', () => assert.match(fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8'), /export class Room\b/));
test('deployConfig derives name/bindings from wrangler text, no migrations', () => {
  const c = deployConfig('{ // c\n "name": "x-app", "compatibility_date": "2025-01-01", "workers_dev": false, "preview_urls": false, "durable_objects": {"bindings":[{"name":"ROOM","class_name":"Room"}]}, "migrations":[{"tag":"v1"}] }');
  assert.equal(c.name, 'x-app');
  assert.deepEqual(c.metadata.bindings, [{ type: 'durable_object_namespace', name: 'ROOM', class_name: 'Room' }]);
  assert.equal(c.metadata.compatibility_date, '2025-01-01');
  assert.equal(c.metadata.migrations, undefined);
  assert.equal(deployConfig(text).name, 'quest-night');
});
