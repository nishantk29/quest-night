// Table jank (Oct 29 2026, Nishant: "Table screen is sooooo janky"; same fix as The Gilded Chamber): a room update must patch the page, not rebuild it.
// morph() is tested on a small fake DOM (the gate has no browser); the browser proof is test/e2e/table-jank.e2e.mjs
// (no #app child replaced on a live update, the seats and board are the same nodes, CLS < 0.1, chat keeps its place).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { morphChildren } from '../public/js/morph.js';

// ---- a fake DOM with just what morph touches
class Node_ {
  constructor(type, name) { this.nodeType = type; this.nodeName = name; this.parentNode = null; this.childNodes = []; this.nodeValue = null; this.ownerDocument = DOC; }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() { const p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) + 1] || null; }
  insertBefore(n, ref) { if (n.parentNode) n.parentNode.removeChild(n); const i = ref ? this.childNodes.indexOf(ref) : this.childNodes.length; this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, n); n.parentNode = this; DOC.ops.push('insert'); return n; }
  removeChild(n) { this.childNodes.splice(this.childNodes.indexOf(n), 1); n.parentNode = null; DOC.ops.push('remove'); return n; }
}
class El extends Node_ {
  constructor(name, attrs = {}) { super(1, name.toUpperCase()); this.attrs = new Map(Object.entries(attrs)); this.value = attrs.value ?? ''; this.checked = 'checked' in attrs; }
  get id() { return this.attrs.get('id') || ''; }
  get type() { return this.attrs.get('type') || 'text'; }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value, namespaceURI: null, localName: name })); }
  hasAttribute(k) { return this.attrs.has(k); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  setAttribute(k, v) { this.attrs.set(k, v); DOC.ops.push('attr'); }
  removeAttribute(k) { this.attrs.delete(k); DOC.ops.push('attr'); }
}
const DOC = { activeElement: null, ops: [] };
const h = (name, attrs, ...kids) => { const e = new El(name, attrs || {}); for (const k of kids) e.insertBefore(typeof k === 'string' ? txt(k) : k, null); return e; };
const txt = (t) => { const n = new Node_(3, '#text'); n.nodeValue = t; return n; };
const html = (n) => (n.nodeType === 3 ? n.nodeValue : `<${n.nodeName.toLowerCase()}${[...n.attrs].map(([k, v]) => ` ${k}="${v}"`).join('')}>${n.childNodes.map(html).join('')}</${n.nodeName.toLowerCase()}>`);
const frag = (...kids) => h('frag', {}, ...kids);
// a Table tab like the live one: board, seats, a chat list and the tab bar badge
const table = (votes, chat, badge) => frag(
  h('section', { class: 'boards' }, h('b', { 'data-roll': 'reform' }, '0/5')),
  h('div', { class: 'table' }, ...['Ana', 'Ben', 'Cal'].map((n, i) => h('div', { class: `knight${votes.includes(n) ? ' is-done' : ''}`, style: `left:${i}%` }, h('span', { class: 'knight-name' }, n)))),
  h('ol', { class: 'msgs', 'data-scroll': 'chat' }, ...chat.map((m) => h('li', { class: 'msg' }, m))),
  h('nav', { class: 'tabbar' }, h('button', { 'data-v': 'chat' }, 'Chat', ...(badge ? [h('b', { class: 'badge' }, String(badge))] : []))));

test('a live update patches in place: every seat, the board and the list are the same nodes afterwards', () => {
  const app = h('div', { id: 'app' }); morphChildren(app, table([], ['hi'], 0));
  const [boards, tbl, list, bar] = app.childNodes; const seats = [...tbl.childNodes];
  const next = table(['Ben'], ['hi', 'Message 2'], 1); DOC.ops = [];
  morphChildren(app, next); // a vote and a chat message arrive
  const ops = DOC.ops.filter((o, i, a) => !(o === 'remove' && a[i + 1] === 'insert')); // a move out of the parsed markup is one insert
  assert.deepEqual(app.childNodes, [boards, tbl, list, bar], 'no top-level node replaced');
  assert.deepEqual(tbl.childNodes, seats, 'no seat replaced');
  assert.equal(seats[1].getAttribute('class'), 'knight is-done');
  assert.equal(list.childNodes.length, 2);
  assert.equal(html(app), html(h('div', { id: 'app' }, ...table(['Ben'], ['hi', 'Message 2'], 1).childNodes)), 'same markup as a full rebuild');
  // only the new message and the new badge were inserted; the rest were attribute/text patches
  assert.equal(ops.filter((o) => o === 'insert').length, 2, ops.join());
  assert.equal(ops.filter((o) => o === 'remove').length, 0, ops.join());
});
test('an identical render touches nothing', () => {
  const app = h('div', {}); morphChildren(app, table(['Ana'], ['a', 'b'], 2)); const same = table(['Ana'], ['a', 'b'], 2); DOC.ops = [];
  morphChildren(app, same);
  assert.deepEqual(DOC.ops, []);
});
test('keyed children (id / data-mk) are matched by key when they move, not rebuilt', () => {
  const row = (ks) => frag(...ks.map((k) => h('li', { 'data-mk': k }, k)));
  const app = h('ul', {}); morphChildren(app, row(['a', 'b', 'c'])); const [a, b, c] = app.childNodes;
  morphChildren(app, row(['c', 'a', 'b']));
  assert.deepEqual(app.childNodes, [c, a, b]);
  morphChildren(app, row(['a', 'c']));
  assert.deepEqual(app.childNodes, [a, c]);
});
test('removed nodes go, changed tags are replaced, text changes in place', () => {
  const app = h('div', {}); morphChildren(app, frag(h('p', {}, 'one'), h('p', {}, 'two'), h('p', {}, 'three')));
  const t0 = app.childNodes[0].firstChild;
  morphChildren(app, frag(h('p', {}, 'uno'), h('h2', {}, 'two')));
  assert.equal(app.childNodes.length, 2); assert.equal(app.childNodes[0].firstChild, t0); assert.equal(t0.nodeValue, 'uno');
  assert.equal(app.childNodes[1].nodeName, 'H2');
});
test('the focused text box keeps what is being typed; other fields follow the markup', () => {
  const app = h('div', {}); morphChildren(app, frag(h('input', { id: 'chat-in', value: '' }), h('input', { id: 'other', value: 'x' })));
  const [inp, other] = app.childNodes; inp.value = 'half a mess'; DOC.activeElement = inp; other.value = 'typed';
  morphChildren(app, frag(h('input', { id: 'chat-in', value: '' }), h('input', { id: 'other', value: 'y' })));
  assert.equal(inp.value, 'half a mess'); assert.equal(other.value, 'y'); DOC.activeElement = null;
});
test('the client paints with morph (no whole-page innerHTML on an update) and the chat only follows when read to the bottom', () => {
  const app = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /morph\(\$app, screen\(\)\)/);
  assert.doesNotMatch(app, /\$app\.innerHTML = screen\(\)/);
  assert.doesNotMatch(app, /for \(const el of \$app\.querySelectorAll\('\[data-scroll\]'\)\) el\.scrollTop = el\.scrollHeight;/);
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /['"]\/js\/morph\.js['"]/, 'morph.js is precached');
});
test('timers write the clock only when the shown second changes', () => {
  const t = readFileSync(new URL('../public/js/table_ui.js', import.meta.url), 'utf8');
  assert.match(t, /if \(el\.textContent !== txt\) el\.textContent = txt;/);
});
