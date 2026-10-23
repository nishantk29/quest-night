import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ROLES, QUEST_SIZES, EVIL_COUNT, roleList, knowledgeFor } from '../public/js/rules.js';
import { roleCards, RECOMMENDED } from '../public/js/cards.js';
import { MODES, KEY, ROLE_ROWS, tableRows, openingScript } from '../public/js/print-guide.js';

const read = (f) => fs.readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const ALL = ['merlin', 'percival', 'morgana', 'mordred', 'oberon'];

test('the three modes are named exactly as in the lobby, in the same order', () => {
  const app = read('js/app.js');
  const lobby = [...app.matchAll(/\['(phone|hybrid|physical)', '([^']+)'/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(MODES.map((m) => [m.id, m.name]), lobby);
});

test('Phones Mode needs no cards, and the guide says so', () => {
  assert.equal(MODES[0].id, 'phone');
  assert.equal(MODES[0].cards, 'None.');
  assert.match(read('js/print.js'), /Phones Mode needs no cards\./);
});

test('every role has one row, with the app’s name and side', () => {
  assert.deepEqual(ROLE_ROWS.map((r) => r.role).sort(), Object.keys(ROLES).sort());
  for (const r of ROLE_ROWS) {
    assert.equal(r.name, ROLES[r.role].name);
    assert.equal(r.side, ROLES[r.role].side === 'good' ? 'Loyal' : 'Evil');
  }
});

test('the Sees column matches what the app shows each role at the start (knowledgeFor)', () => {
  // A full 10-player table with every special role on: one player per role id, in the order the app deals them.
  const { roles } = roleList(10, { merlin: true, percival: true, morgana: true, mordred: true, oberon: true });
  const roleOf = Object.fromEntries(roles.map((r, i) => [`p${i}`, r]));
  const idOf = Object.fromEntries(roles.map((r, i) => [r, `p${i}`]));
  const sees = (role) => knowledgeFor(idOf[role], roleOf).map((k) => roleOf[k.id]).sort();
  assert.deepEqual(sees('merlin'), ['assassin', 'minion', 'morgana', 'oberon'].filter((r) => roles.includes(r)).sort(), 'Merlin: Evil except Mordred');
  assert.deepEqual(sees('percival'), ['merlin', 'morgana']);
  assert.deepEqual(sees('oberon'), []);
  assert.deepEqual(sees('servant'), []);
  assert.ok(!sees('assassin').includes('oberon') && !sees('mordred').includes('oberon'), 'Evil does not see Oberon');
  const row = (id) => ROLE_ROWS.find((r) => r.role === id).sees;
  assert.match(row('merlin'), /except Mordred/);
  assert.match(row('percival'), /Merlin and Morgana/);
  assert.match(row('oberon'), /Nobody/);
  assert.match(row('servant'), /Nothing/);
});

test('party sizes and the 7+ two-sabotage rule match rules.js, for 5 to 10 players', () => {
  const rows = tableRows();
  assert.deepEqual(rows.map((r) => r.n), [5, 6, 7, 8, 9, 10]);
  for (const r of rows) {
    assert.equal(r.loyal + r.evil, r.n);
    assert.equal(r.evil, EVIL_COUNT[r.n]);
    assert.deepEqual(r.sizes.map((s) => s.size), QUEST_SIZES[r.n]);
    assert.deepEqual(r.sizes.map((s) => s.twoFails), QUEST_SIZES[r.n].map((_, i) => r.n >= 7 && i === 3));
  }
});

test('each table size pulls exactly one card per player, in the right colour for its side', () => {
  for (let n = 5; n <= 10; n++) {
    const { cards, error } = roleCards(n, RECOMMENDED(n));
    assert.equal(error, undefined);
    assert.equal(cards.length, n);
    assert.equal(new Set(cards.map((c) => c.card)).size, n, `${n} players: no card used twice`);
    for (const c of cards) {
      const red = /[♥♦]/.test(c.card);
      assert.equal(red, ROLES[c.role].side === 'good', `${c.card} is ${ROLES[c.role].side}`);
    }
  }
});

test('one regular deck is enough: key cards and role cards never overlap, and no suit runs past 13', () => {
  const key = KEY.flatMap((k) => k.pool);
  assert.equal(new Set(key).size, key.length, 'key cards are unique');
  for (let n = 5; n <= 10; n++) {
    const role = roleCards(n, RECOMMENDED(n)).cards.map((c) => c.card);
    assert.equal(role.filter((c) => key.includes(c)).length, 0, `${n} players: role cards avoid key cards`);
  }
  const suitCount = (s) => key.filter((c) => c.startsWith(s)).length;
  for (const s of ['♥', '♠', '♦', '♣']) assert.ok(suitCount(s) <= 13, `${s} has ${suitCount(s)} cards in the key`);
});

test('quest parties never need more quest cards than the key gives (A–5 of each)', () => {
  for (const r of tableRows()) assert.ok(Math.max(...r.sizes.map((s) => s.size)) <= 5);
});

test('the opening script matches the app’s own lines (app.js openingScript)', () => {
  const app = read('js/app.js');
  for (const line of ['Everyone, close your eyes and put your hand in a fist on the table.', 'These are your allies.',
    'Merlin, open your eyes. These players serve Evil.', 'Merlin, close your eyes. Evil, lower your thumbs.',
    'Percival, open your eyes.', 'This is Merlin.', 'Thumbs down.', 'Everyone, open your eyes.']) {
    assert.ok(app.includes(line), `app.js has: ${line}`);
  }
  const full = openingScript(ALL).join('\n');
  assert.match(full, /Evil, except Oberon, open your eyes/);
  assert.match(full, /Evil, except Mordred, raise your thumb\./);
  assert.match(full, /Merlin and Morgana, raise your thumb\./);
  assert.match(full, /One of these is Merlin\./);
  const merlinOnly = openingScript(['merlin']).join('\n');
  assert.match(merlinOnly, /Evil raise your thumb\./);
  assert.doesNotMatch(merlinOnly, /Percival|Oberon|Mordred/);
  assert.match(openingScript(['merlin', 'percival']).join('\n'), /This is Merlin\./);
  assert.equal(openingScript(ALL).at(-1), 'Everyone, open your eyes.');
});

test('copy follows COPY-STYLE: Host, never storyteller; the guide says Phones Mode needs no cards', () => {
  for (const f of ['js/print.js', 'js/print-guide.js']) {
    assert.doesNotMatch(read(f), /storyteller/i, `${f} says storyteller`);
  }
  assert.match(read('js/print.js'), /Host sits out/);
  for (const f of ['js/print.js', 'js/print-guide.js', 'print.html']) assert.doesNotMatch(read(f), /phones only|all at the table|all physical/i, `${f} uses an old mode name`);
});
