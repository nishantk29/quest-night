// Copy gate (design review, 2026-10-28: "Make sure the text is checked to avoid AI wording"). Shared lint vendored in test/kit/copy-lint.mjs.
// Scans every user-facing string: the FAQ, role and power text, and every .js/.html file the site ships (tags stripped).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { lintCopy } from './kit/copy-lint.mjs';
import { FAQ } from '../public/js/faq.js';
import { ROLES } from '../public/js/rules.js';

const pub = new URL('../public/', import.meta.url).pathname;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (['fonts', 'icons', 'print', 'node_modules'].includes(e.name) ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));

test('copy lint: FAQ and roles have no AI wording', () => {
  const strings = [...FAQ.flatMap(([g, qs]) => [g, ...qs.flat()]), ...Object.values(ROLES).flatMap((r) => [r.name, r.blurb])];
  const hits = strings.flatMap((s) => lintCopy(String(s).replace(/<[^>]+>/g, ' ')).map((i) => `${i} in "${String(s).slice(0, 50)}"`));
  assert.deepEqual(hits, []);
});

test('copy lint: every shipped .js/.html file (buttons, tips, narration)', () => {
  const hits = [];
  for (const f of walk(pub).filter((f) => /\.(js|html)$/.test(f) && !/(sw|qr)\.js$/.test(f))) {
    fs.readFileSync(f, 'utf8').replace(/<[^>]+>/g, ' ').split('\n').forEach((line, i) => { for (const x of lintCopy(line)) hits.push(`${path.relative(pub, f)}:${i + 1} ${x}`); });
  }
  assert.deepEqual(hits, []);
});

test('copy lint catches a planted phrase (the gate is live)', () => {
  assert.ok(lintCopy('Embark on a seamless night').length >= 2);
});
