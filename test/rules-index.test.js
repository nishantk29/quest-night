// The committed rules index must match the FAQ, so "Ask a rule" never answers from stale rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildIndex, hashOf } from '../scripts/build-rules-index.mjs';
import { RULES_INDEX, RULES_HASH } from '../src/rules-index.js';

test('rules index is up to date with faq.js (run node scripts/build-rules-index.mjs)', async () => {
  const idx = await buildIndex(path.resolve(import.meta.dirname, '..'));
  assert.deepEqual(idx, RULES_INDEX);
  assert.equal(hashOf(idx), RULES_HASH);
});
