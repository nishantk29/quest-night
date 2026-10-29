// Back closes the open sheet first: the shell keeps back-sheet.js in step with every <dialog> on <body>
// (e2e: test/e2e/back-nav.e2e.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const app = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
test('app.js wires Back to the open dialogs, closing the top one like Escape, and the SW precaches back-sheet.js', () => {
  assert.match(app, /import \{ backClosesSheets \} from '\.\/back-sheet\.js'/);
  assert.match(app, /querySelectorAll\('dialog\[open\]'\)\]\.at\(-1\)/);
  assert.match(app, /new Event\('cancel', \{ cancelable: true \}\)/);
  assert.match(app, /new MutationObserver\(\(\) => backNav\.sync\(\)\)\.observe\(document\.body, \{ childList: true \}\)/);
  assert.ok(sw.includes("'/js/back-sheet.js'"));
});
