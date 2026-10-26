// The deploy gate really blocks: a failing suite gives ok:false, a passing one ok:true, and build-deploy writes nothing when it fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runGate, expandGlob } from '../scripts/test-gate.mjs';

const REPO = path.resolve(import.meta.dirname, '..');
function project(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'test', 'a.test.js'), `import { test } from 'node:test'; import assert from 'node:assert/strict';\n${body}`);
  return dir;
}

test('deploy gate: a failing test file blocks (ok false, fail counted)', async () => {
  const dir = project(`test('red', () => assert.equal(1, 2));`);
  const g = await runGate({ cwd: dir, quiet: true });
  assert.equal(g.ok, false); assert.equal(g.fail, 1);
});
test('deploy gate: a passing test file passes (ok true)', async () => {
  const dir = project(`test('green', () => assert.equal(1, 1));`);
  const g = await runGate({ cwd: dir, quiet: true });
  assert.deepEqual(g, { ok: true, pass: 1, fail: 0 });
});
test('deploy gate: a crashing test file or no test files never counts as green', async () => {
  const crash = await runGate({ cwd: project(`throw new Error('boom');`), quiet: true });
  assert.equal(crash.ok, false);
  const none = await runGate({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'gate-')), quiet: true });
  assert.equal(none.ok, false);
});
test('deploy gate: the glob expands with fs and sorts', () => {
  const dir = project(`test('x', () => {});`);
  fs.writeFileSync(path.join(dir, 'test', 'b.test.js'), '');
  fs.writeFileSync(path.join(dir, 'test', 'c.txt'), '');
  assert.deepEqual(expandGlob(dir, 'test/*.test.js'), [path.join('test', 'a.test.js'), path.join('test', 'b.test.js')]);
});
test('deploy gate: build-deploy exits 1 with "Deploy file NOT written" and creates no file when a test fails', () => {
  const dir = project(`test('red', () => assert.equal(1, 2));`);
  const out = path.join(dir, 'deploy.js');
  const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'build-deploy.mjs'), out], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Deploy file NOT written: 1 test\(s\) failed/);
  assert.equal(fs.existsSync(out), false);
});
test('deploy gate: build-deploy has no bypass flag or env switch', () => {
  const src = fs.readFileSync(path.join(REPO, 'scripts', 'build-deploy.mjs'), 'utf8');
  assert.ok(src.indexOf('runGate(') > 0 && src.indexOf('runGate(') < src.indexOf('writeFileSync'));
  assert.ok(!/process\.env|--skip|--force|--no-test/.test(src));
});
