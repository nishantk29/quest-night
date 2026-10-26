// Reusable deploy gate: runs `node --test` over a glob and reports { ok, pass, fail }. No dependencies.
// Use in another repo: copy this one file into its scripts/ folder and, at the top of its build-deploy script, before
// anything is written:   const g = await runGate({ cwd: process.cwd() });
//                        if (!g.ok) { console.error(`Deploy file NOT written: ${g.fail} test(s) failed`); process.exit(1); }
// CLI: `node scripts/test-gate.mjs [glob]` exits 1 on any failure (also when no test files match or the run crashes).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Node 20 has no glob in --test, so expand "dir/*.test.js" ourselves (a wildcard in the last path segment only).
export function expandGlob(cwd, pattern) {
  const dir = path.dirname(pattern), base = path.basename(pattern);
  if (!base.includes('*')) return fs.existsSync(path.join(cwd, pattern)) ? [pattern] : [];
  const re = new RegExp('^' + base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  const abs = path.join(cwd, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs).filter((f) => re.test(f)).sort().map((f) => path.join(dir, f));
}

// Inside another `node --test` run (the gate's own test) this variable would make the child emit machine output, not TAP.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));

export function runGate({ cwd = process.cwd(), files = 'test/*.test.js', quiet = false } = {}) {
  const list = (Array.isArray(files) ? files : [files]).flatMap((g) => expandGlob(cwd, g));
  if (!list.length) { if (!quiet) console.error(`test gate: no test files match ${files}`); return Promise.resolve({ ok: false, pass: 0, fail: 1 }); }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap', ...list], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv });
    let out = '';
    const failed = [];
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { if (!quiet) process.stderr.write(d); });
    child.on('error', (e) => { if (!quiet) console.error('test gate: could not start node --test:', e.message); resolve({ ok: false, pass: 0, fail: 1 }); });
    child.on('close', (code) => {
      const n = (k) => Number((out.match(new RegExp(`^# ${k} (\\d+)`, 'm')) || [])[1] || 0);
      for (const m of out.matchAll(/^not ok \d+ - (.*)$/gm)) failed.push(m[1]);
      let pass = n('pass'), fail = n('fail');
      if (code !== 0 && fail === 0) fail = 1; // crashed run: never report green
      if (code === 0 && pass === 0) fail = 1; // nothing ran
      if (!quiet) {
        console.log(`test gate: ${list.length} files, ${pass} passed, ${fail} failed`);
        for (const f of failed.slice(0, 20)) console.log(`  FAILED: ${f}`);
      }
      resolve({ ok: code === 0 && fail === 0, pass, fail });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { ok } = await runGate({ cwd: process.cwd(), files: process.argv[2] || 'test/*.test.js' });
  process.exit(ok ? 0 : 1);
}
