// House-rule gate: one describe per house rule (RULES.md has the table). Rules already covered by a named test elsewhere
// are cited, and each citation is checked to still exist, so a renamed or deleted test fails here instead of rotting.
// A few rules with no single owner get a direct check below.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { newRoom, reduce, viewForPlayer, LATEST_RULES_VERSION } from '../public/js/room.js';
import { computeVersion, swVersion } from '../scripts/sw-version.mjs';

const titles = {};
const has = (file, name) => (titles[file] ||= fs.readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')).includes(name);
function cites(file, ...names) {
  test(`covered by ${file}`, () => { for (const n of names) assert.ok(has(file, n), `${file} has no test named "${n}"`); });
}

describe('house rule: Merlin sees Evil but not Mordred', () => {
  cites('rules.test.js', "exactly what each Avalon role knows", "who sees whom");
  cites('audit-v2.test.js', 'knowledge-order:');
});
describe('house rule: Percival sees Merlin and Morgana in random order', () => {
  cites('audit-v2.test.js', 'percival-order: the two candidates come in a per-game random order', 'old-game-order:');
  cites('roles-sheet.test.js', 'Percival and Morgana say Percival sees two candidates');
});
describe('house rule: Evil see each other but not Oberon, and Oberon is alone', () => {
  cites('rules.test.js', 'exactly what each Avalon role knows');
  cites('audit-v2.test.js', 'assassin-phase-oberon:', 'strike-no-oracle:');
});
describe('house rule: Good players cannot sabotage', () => {
  cites('room.test.js', 'good cannot sabotage');
  cites('audit-v2.test.js', 'good-never-sabotages:');
});
describe('house rule: quest 4 needs two fails at 7+ players', () => {
  cites('rules.test.js', 'two sabotage cards needed only on quest 4 with 7+ players');
  cites('logic-audit.test.js', 'quest 4 needs two fails from 7 players up');
  cites('audit-v2.test.js', 'quest-four:');
});
describe('house rule: the fifth rejection in a row is an Evil win', () => {
  cites('room.test.js', 'five rejects hand Evil the game');
  cites('audit-v2.test.js', 'five-rejections:');
});
describe('house rule: the Assassin strikes after three successes, only when an Assassin exists', () => {
  cites('room.test.js', 'assassin: naming Merlin wins for Evil', 'without Merlin, three successes end the game');
  cites('audit-v2.test.js', 'no-assassin:', 'assassin-skip:');
});
describe('house rule: Lantern', () => {
  cites('table.test.js', 'the Lantern: starts right of the first leader');
  cites('audit-v2.test.js', 'lantern:');
});
describe('house rule: the roles sheet is static and identical for everyone', () => {
  cites('roles-sheet.test.js', 'identical for every viewer and every phase', 'a watcher or screen joining mid-game sees the same dealt setup');
});
describe('house rule: Restart keeps the room and re-deals on the latest rules', () => {
  cites('restart.test.js', 'restart keeps code, players, settings, mode and host', 'a v1 room moves to the latest rules on restart');
});
describe('house rule: a room keeps the rulesVersion it was created with', () => {
  test('new rooms get the latest; a missing field reads as 1 and is never backfilled by joining, settings or viewing (only a start / restart moves it)', () => {
    assert.equal(newRoom('ABCDEF', 'hk').rulesVersion, LATEST_RULES_VERSION);
    const room = newRoom('ABCDEF', 'hk'); delete room.rulesVersion;
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(reduce(room, { anon: true }, { type: 'join', name: `P${i}`, hostKey: i ? undefined : 'hk' }).data.playerId);
    reduce(room, { playerId: ids[0] }, { type: 'settings', settings: { merlin: true } });
    assert.equal(room.rulesVersion, undefined);
    viewForPlayer(room, ids[1]);
    assert.equal(room.rulesVersion, undefined, 'viewing never backfills');
  });
  cites('restart.test.js', 'a room without rulesVersion is version 1 and is not backfilled', 'Play again from the end screen leaves a v1 room on v1 until the next start');
  cites('audit-v2.test.js', 'assassin-skip: rooms still on rulesVersion 1 keep the old behaviour');
});
describe('house rule: every role gets the same reveal look and duration', () => {
  cites('phones.test.js', 'reveal: every role takes the same path', 'phones mode: the hidden card never contains the role', 'phones mode: Success and Sabotage look identical for every role');
});
describe('house rule: no leaks in any phase', () => {
  cites('table.test.js', 'secrecy: no view carries another player');
  cites('room.test.js', 'secrecy: a player view holds only their own role', 'secrecy: quest cards never leave the room');
  cites('audit-v2.test.js', 'screen-view:', 'quest-cards-private:', 'moderator-view:', 'kicked-socket:');
  cites('sim-invariants.test.js', 'sim: no leaks');
  cites('restart.test.js', 'after a restart every view is the fresh reveal');
});
describe('house rule: reconnecting to a living game gives the same view', () => {
  cites('audit-v2.test.js', 'reconnect: a fresh view for the same id shows the same private card and own vote');
});
describe('house rule: error pages are styled and leak nothing', () => {
  cites('error-pages.test.js', 'unknown path: styled 404', 'a thrown error becomes a styled 500 with no stack', 'client error screens:', 'crash handler output never includes the error message or stack');
});
describe('house rule: the host flow never dead-ends', () => {
  cites('host-no-dead-end.test.js', 'host flow never dead-ends: ~300 seeded games', 'host flow never dead-ends: steps with nothing to choose are enabled right away', 'host flow never dead-ends: the screen uses hostNav', 'host flow never dead-ends: a physical-play Host names a party');
  cites('audit-v2.test.js', 'assassin-skip: physical roles skip to no strike');
});
describe('house rule: the FAQ matches the game', () => {
  cites('faq-drift.test.js', 'FAQ explains exactly the roles, settings, house rules and modes the game has');
});
describe('house rule: the service worker version is fresh', () => {
  test('public/sw.js VERSION matches the content hash of public/', () => {
    assert.equal(swVersion(), computeVersion(), 'public/ changed since the last stamp: run `node scripts/stamp-sw.mjs public` or make-pwa');
  });
  cites('pwa-fresh.test.js', 'service worker: HTML fetched with no-cache');
});
describe('house rule: whole simulated games never break an invariant', () => {
  cites('sim-invariants.test.js', 'sim: no impossible states', 'sim: right winner', 'sim: knowledge correct', 'sim: restart resets');
});
