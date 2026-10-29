// Back closes the open sheet first (back-sheet.js). A fake window with a real-shaped session history: pushState adds a
// same-document entry, back() lands asynchronously and fires popstate, like a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { backClosesSheets } from '../public/js/back-sheet.js';

function fakeWindow() {
  const L = { popstate: [] };
  const w = {
    entries: [{ url: '/room', state: null }], i: 0, left: false, pending: [],
    addEventListener(t, f) { (L[t] ||= []).push(f); },
    history: {
      get state() { return w.entries[w.i].state; },
      get length() { return w.entries.length; },
      pushState(state) { w.entries = w.entries.slice(0, w.i + 1); w.entries.push({ url: w.entries[w.i].url, state: structuredClone(state) }); w.i += 1; },
      back() { w.pending.push(-1); },
    },
    // what the browser does with Back (user or script): same document entry -> popstate; before the first -> page left
    async userBack() { w.pending.push(-1); await w.flush(); },
    async flush() { while (w.pending.length) { const d = w.pending.shift(); await null; if (w.i + d < 0) { w.left = true; continue; } w.i += d; for (const f of L.popstate) f({ state: w.history.state }); } },
  };
  return w;
}
// A tiny screen: a stack of sheets; `sticky` ones ignore close (a step that has to be answered).
function screen(w) {
  const s = { stack: [] };
  const nav = backClosesSheets(() => { const t = s.stack.at(-1); return t ? { key: t.name, close: () => { if (!t.sticky) { s.stack.pop(); nav.sync(); } } } : null; }, w);
  s.open = (name, sticky = false) => { s.stack.push({ name, sticky }); nav.sync(); };
  s.tapClose = () => { s.stack.pop(); nav.sync(); };
  return s;
}

test('Back with a sheet open closes the sheet and stays on the screen', async () => {
  const w = fakeWindow(); const s = screen(w);
  s.open('roles');
  assert.equal(w.history.length, 2);
  await w.userBack();
  assert.deepEqual(s.stack, []);
  assert.equal(w.left, false);
  assert.equal(w.entries[w.i].url, '/room');
  await w.userBack();
  assert.equal(w.left, true, 'the next Back leaves as before: nothing traps it');
});

test('closing by tap pops the entry, so open and close ten times adds nothing', async () => {
  const w = fakeWindow(); const s = screen(w);
  for (let k = 0; k < 10; k++) { s.open('menu'); s.tapClose(); await w.flush(); }
  assert.equal(w.i, 0, 'back on the screen entry');
  await w.userBack();
  assert.equal(w.left, true, 'one Back leaves the screen');
});

test('a sheet that stays open after Back does not trap Back', async () => {
  const w = fakeWindow(); const s = screen(w);
  s.open('gate', true);
  await w.userBack();
  assert.equal(s.stack.length, 1);
  assert.equal(w.left, false);
  await w.userBack();
  assert.equal(w.left, true);
});

test('stacked sheets close one per Back, top first', async () => {
  const w = fakeWindow(); const s = screen(w);
  s.open('menu'); s.stack.push({ name: 'confirm' }); // the second opens over the first in the same repaint
  await w.userBack();
  assert.deepEqual(s.stack.map((x) => x.name), ['menu']);
  await w.userBack();
  assert.deepEqual(s.stack, []);
  assert.equal(w.left, false);
});

test('a real navigation while a sheet is open is never undone by the sheet closing', async () => {
  const w = fakeWindow(); const s = screen(w);
  s.open('help');
  w.entries.push({ url: '/faq', state: null }); w.i += 1; // a link inside the sheet (hashchange push)
  s.tapClose(); await w.flush();
  assert.equal(w.entries[w.i].url, '/faq', 'no history.back() from the new page');
});

test('opening another sheet right after a tap-close keeps exactly one entry', async () => {
  const w = fakeWindow(); const s = screen(w);
  s.open('a'); s.tapClose(); s.open('b'); await w.flush();
  assert.equal(w.history.state?.backSheet !== undefined, true, 'b has its entry');
  await w.userBack();
  assert.deepEqual(s.stack, []);
  assert.equal(w.left, false);
});
