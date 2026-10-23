import test from 'node:test';
import assert from 'node:assert/strict';
import { newRoom, reduce, viewForPlayer, viewForScreen } from '../public/js/room.js';
import { ROLES, QUEST_SIZES, EVIL_COUNT, knowledgeFor, roleList } from '../public/js/rules.js';
import { roleCards, RECOMMENDED } from '../public/js/cards.js';

const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const must = (r) => { assert.ok(r.ok, r.error); return r; };
const act = (room, id, msg, rng, now) => reduce(room, { playerId: id }, msg, rng, now);
const side = (room, id) => ROLES[room.game.roles[id]].side;

function lobby(n, { settings = { merlin: true }, house = {}, mode, phoneless = 0, seed = 1 } = {}) {
  const rng = seeded(seed); const room = newRoom('ABCDEF', 'hk'); const ids = [];
  for (let i = 0; i < n - phoneless; i++) ids.push(must(reduce(room, {}, { type: 'join', name: `P${i}`, hostKey: i === 0 ? 'hk' : undefined }, rng)).data.playerId);
  const host = ids[0];
  for (let i = 0; i < phoneless; i++) { must(act(room, host, { type: 'addSeat', name: `Card${i}` })); ids.push(room.players.at(-1).id); }
  must(act(room, host, { type: 'settings', settings }));
  if (Object.keys(house).length) must(act(room, host, { type: 'house', house }));
  if (mode) must(act(room, host, { type: 'mode', mode }));
  return { room, ids, host, rng };
}
function started(n, opts = {}) {
  const t = lobby(n, opts);
  must(act(t.room, t.host, { type: 'start' }, t.rng));
  for (const id of t.ids) if (!t.room.players.find((p) => p.id === id).phoneless && t.room.phase === 'reveal') act(t.room, id, { type: 'ready' });
  if (t.room.phase === 'reveal') must(act(t.room, t.host, { type: 'skipReveal' }));
  return t;
}
const leader = (room) => viewForPlayer(room, room.players[0].id).game.leader;
function goParty(t, team, approve = () => true) {
  must(act(t.room, leader(t.room), { type: 'propose', team }));
  for (const id of t.ids) must(act(t.room, id, { type: 'vote', approve: approve(id) }));
}

test('every table size deals the right sides, and knowledge matches the classic rules', () => {
  for (let n = 5; n <= 10; n++) for (const s of [RECOMMENDED(n), { merlin: true }, { merlin: false }]) {
    const list = roleList(n, s); if (list.error) continue;
    const t = started(n, { settings: s, seed: n * 7 });
    const roles = t.room.game.roles;
    assert.equal(Object.values(roles).filter((r) => ROLES[r].side === 'evil').length, EVIL_COUNT[n]);
    for (const id of t.ids) {
      const k = knowledgeFor(id, roles);
      if (roles[id] === 'merlin') for (const x of k) assert.ok(ROLES[roles[x.id]].side === 'evil' && roles[x.id] !== 'mordred');
      if (roles[id] === 'oberon' || roles[id] === 'servant') assert.equal(k.length, 0);
      assert.deepEqual(viewForPlayer(t.room, id).me.sees, k);
    }
  }
});

test('playing-card guide: unique cards, right colours, every size', () => {
  for (let n = 5; n <= 10; n++) {
    const r = roleCards(n, RECOMMENDED(n));
    assert.equal(r.cards.length, n);
    assert.equal(new Set(r.cards.map((c) => c.card)).size, n, 'no card twice');
    for (const c of r.cards) assert.equal(/[♥♦]/.test(c.card), ROLES[c.role].side === 'good', `${c.card} colour = side`);
    assert.deepEqual(r.sizes, QUEST_SIZES[n]);
  }
});

test('the Lantern: starts right of the first leader, used after quests 2-4, passes on, never back', () => {
  const t = started(7, { settings: RECOMMENDED(7), house: { lantern: true }, seed: 3 });
  const g = t.room.game; const seats = t.ids;
  assert.equal(g.lantern.holder, seats[(g.leader - 1 + 7) % 7]);
  goParty(t, seats.slice(0, 2)); for (const id of seats.slice(0, 2)) must(act(t.room, id, { type: 'play', sabotage: false }));
  assert.equal(t.room.phase, 'propose', 'no Lantern after quest 1');
  goParty(t, seats.slice(0, 3)); for (const id of seats.slice(0, 3)) must(act(t.room, id, { type: 'play', sabotage: false }));
  assert.equal(t.room.phase, 'lantern');
  const holder = g.lantern.holder; const other = seats.find((id) => id !== holder);
  assert.ok(act(t.room, other, { type: 'examine', id: holder }).error, 'only the holder');
  assert.ok(act(t.room, holder, { type: 'examine', id: holder }).error, 'not yourself');
  must(act(t.room, holder, { type: 'examine', id: other }));
  assert.equal(viewForPlayer(t.room, holder).me.lanternSeen[0].side, side(t.room, other));
  assert.equal(viewForPlayer(t.room, other).me.lanternSeen, undefined, 'only the holder sees');
  assert.equal(JSON.stringify(viewForScreen(t.room)).includes('"side":"'), false, 'the table screen never sees it');
  assert.equal(t.room.game.lantern.holder, other);
  // after quest 3 the new holder can't look back at the old holder
  goParty(t, seats.slice(0, 3), () => true);
  for (const id of seats.slice(0, 3)) must(act(t.room, id, { type: 'play', sabotage: false }));
  if (t.room.phase === 'lantern') assert.ok(act(t.room, other, { type: 'examine', id: holder }).error);
});

test('physical mode: phoneless seats, host enters votes and quest results, no roles anywhere', () => {
  const t = started(5, { mode: { play: 'physical' }, phoneless: 4 });
  assert.equal(t.room.game.roles, null);
  assert.equal(t.room.phase, 'propose');
  const lead = leader(t.room);
  must(act(t.room, t.host, { type: 'propose', team: t.ids.slice(0, 2) }));
  assert.ok(act(t.room, t.host, { type: 'vote', approve: true }).error, 'votes are at the table');
  must(act(t.room, t.host, { type: 'tally', approve: t.ids.slice(0, 3) }));
  assert.equal(t.room.phase, 'quest');
  assert.ok(act(t.room, t.host, { type: 'questResult', fails: 3 }).error);
  must(act(t.room, t.host, { type: 'questResult', fails: 1 }));
  assert.deepEqual(t.room.game.results, ['fail']);
  assert.notEqual(leader(t.room), lead);
});

test('hybrid: phoneless seats are refused while any piece is in the app', () => {
  const t = lobby(5, { mode: { play: 'hybrid', roles: 'physical', votes: 'app', cards: 'physical' }, phoneless: 1 });
  assert.match(act(t.room, t.host, { type: 'start' }, t.rng).error, /no phone/);
  must(act(t.room, t.host, { type: 'mode', mode: { play: 'hybrid', votes: 'physical' } }));
  must(act(t.room, t.host, { type: 'start' }, t.rng));
});

test('physical roles: the Assassin phase takes the host’s entry', () => {
  const t = started(5, { mode: { play: 'physical' } });
  for (let q = 0; q < 3; q++) { must(act(t.room, t.host, { type: 'propose', team: t.ids.slice(0, QUEST_SIZES[5][q]) })); must(act(t.room, t.host, { type: 'tally', approve: t.ids })); must(act(t.room, t.host, { type: 'questResult', fails: 0 })); }
  assert.equal(t.room.phase, 'assassin');
  must(act(t.room, t.host, { type: 'strikeResult', id: t.ids[2], hit: true }));
  assert.equal(t.room.game.winner, 'evil');
});

test('host tools: skip, pause, undo, nudge, open a seat and take it over, hand off', () => {
  const t = started(5);
  const lead = leader(t.room);
  must(act(t.room, lead, { type: 'propose', team: t.ids.slice(0, 2) }));
  must(act(t.room, t.host, { type: 'pause' }, null, 1000));
  assert.match(act(t.room, t.ids[1], { type: 'vote', approve: true }).error, /paused/);
  must(act(t.room, t.host, { type: 'resume' }));
  for (const id of t.ids.slice(0, 4)) must(act(t.room, id, { type: 'vote', approve: true }));
  must(act(t.room, t.host, { type: 'skip', id: t.ids[4] }));
  assert.equal(t.room.game.lastVote.reject.includes(t.ids[4]), true, 'a skipped vote is a reject');
  assert.equal(t.room.phase, 'quest');
  must(act(t.room, t.host, { type: 'undo' }));
  assert.equal(t.room.phase, 'vote', 'undo goes back one step');
  must(act(t.room, t.host, { type: 'nudge', id: t.ids[4] }));
  assert.equal(viewForPlayer(t.room, t.ids[4]).me.nudged, 1);
  const before = t.room.game.roles[t.ids[3]];
  must(act(t.room, t.host, { type: 'kick', id: t.ids[3] }));
  const r = must(reduce(t.room, {}, { type: 'join', name: 'Newcomer' }, t.rng));
  assert.equal(r.data.playerId, t.ids[3], 'takes over the same seat');
  assert.equal(viewForPlayer(t.room, t.ids[3]).me.role.id, before);
  must(act(t.room, t.host, { type: 'handoff', id: t.ids[1] }));
  assert.ok(t.room.players.find((p) => p.id === t.ids[1]).host);
  assert.ok(act(t.room, t.host, { type: 'pause' }).error);
  assert.ok(t.room.log.some((m) => /skipped/.test(m.text)) && t.room.log.some((m) => /undid/.test(m.text)));
});

test('chat, claims, no-claims mode, mute and moderation', () => {
  const t = started(5, { house: { noClaims: false } });
  must(act(t.room, t.ids[1], { type: 'chat', text: 'hello <b>there</b>' }));
  must(act(t.room, t.ids[1], { type: 'claim', text: 'I played Success' }));
  const v = viewForPlayer(t.room, t.ids[2]);
  assert.ok(v.log.some((m) => m.kind === 'claim' && m.by === 'P1'));
  const n = t.room.log.find((m) => m.kind === 'chat').n;
  must(act(t.room, t.host, { type: 'hideMsg', n }));
  assert.equal(viewForPlayer(t.room, t.ids[2]).log.find((m) => m.n === n).text, '(removed by the host)');
  must(act(t.room, t.host, { type: 'mute', id: t.ids[1] }));
  assert.ok(act(t.room, t.ids[1], { type: 'chat', text: 'x' }).error);
  const t2 = started(5, { house: { noClaims: true } });
  assert.ok(act(t2.room, t2.ids[1], { type: 'claim', text: 'x' }).error);
});

test('Table Tools: coin, dice, picker and tallies are logged for all; timers pause', () => {
  const t = started(5);
  must(act(t.room, t.ids[2], { type: 'coin' }, t.rng));
  must(act(t.room, t.ids[2], { type: 'dice', count: 3, sides: 20 }, t.rng));
  must(act(t.room, t.ids[2], { type: 'pickPlayer' }, t.rng));
  const tools = t.room.log.filter((m) => m.kind === 'tool').map((m) => m.text).join('\n');
  assert.match(tools, /coin: (Heads|Tails)/); assert.match(tools, /3d20: \d+, \d+, \d+ \(total \d+\)/); assert.match(tools, /random player: P\d/);
  assert.ok(act(t.room, t.ids[2], { type: 'timer', secs: 60 }).error, 'only the host runs shared timers');
  must(act(t.room, t.host, { type: 'timer', secs: 60 }, t.rng, 1000));
  must(act(t.room, t.host, { type: 'pause' }, t.rng, 21000));
  assert.equal(t.room.timer.left, 40000);
  must(act(t.room, t.host, { type: 'resume' }, t.rng, 99000));
  assert.equal(t.room.timer.endsAt, 139000);
  must(act(t.room, t.host, { type: 'talk', secs: 30 }, t.rng, 0));
  must(act(t.room, t.room.talk.order[0], { type: 'talkNext' }, t.rng, 0));
  assert.equal(t.room.talk.i, 1);
  must(act(t.room, t.host, { type: 'poll', q: 'Who?', players: true }));
  must(act(t.room, t.ids[1], { type: 'pollVote', i: 0 })); must(act(t.room, t.ids[2], { type: 'pollVote', i: 1 }));
  must(act(t.room, t.host, { type: 'pollClose', tiebreak: true }, t.rng));
  assert.match(t.room.log.at(-1).text, /Tie broken at random/);
  must(act(t.room, t.host, { type: 'counter', op: 'add', label: 'Round' }));
  must(act(t.room, t.host, { type: 'counter', op: 'inc', id: t.room.counters[0].id }));
  assert.equal(t.room.counters[0].value, 1);
});

test('house rules: anonymous votes hide names; phase timer starts on each phase', () => {
  const t = started(5, { house: { anonVotes: true, turnTimer: 60 } });
  goParty(t, t.ids.slice(0, 2), (id) => id !== t.ids[4]);
  const v = viewForPlayer(t.room, t.ids[1]);
  assert.deepEqual(v.game.lastVote.approve, []); assert.equal(v.game.lastVote.yes, 4);
  assert.equal(JSON.stringify(v.log).includes('approve:'), false);
  assert.ok(t.room.timer?.auto);
});

test('storyteller sits out: not dealt, sees the whole deal; players and the screen never do', () => {
  const t = started(6, { house: { sitOut: true } });
  assert.equal(t.room.game.n, 5);
  assert.equal(t.room.game.roles[t.host], undefined);
  assert.equal(Object.keys(viewForPlayer(t.room, t.host).moderator.roles).length, 5);
  assert.equal(viewForPlayer(t.room, t.ids[1]).moderator, undefined);
  assert.equal(viewForScreen(t.room).moderator, undefined);
});

test('secrecy: no view carries another player’s role, a token or the host key', () => {
  for (const n of [5, 7, 10]) {
    const t = started(n, { settings: RECOMMENDED(n), house: { lantern: n >= 7 } });
    for (const id of t.ids) {
      const v = viewForPlayer(t.room, id); const txt = JSON.stringify(v);
      assert.ok(!/token|hostKey|"roles":\{/.test(txt));
      for (const other of t.ids) if (other !== id && !v.me.sees.some((k) => k.id === other)) assert.equal(txt.includes(`"${t.room.game.roles[other]}"`) && t.room.game.roles[other] !== v.me.role.id && !t.room.game.roleSet.includes(t.room.game.roles[other]), false);
    }
    const sv = JSON.stringify(viewForScreen(t.room));
    assert.ok(!/token|hostKey|"role":|"sees"|"roles":\{/.test(sv));
  }
});

test('a late joiner watches without a card', () => {
  const t = started(5);
  const r = must(reduce(t.room, {}, { type: 'join', name: 'Late' }, t.rng));
  const v = viewForPlayer(t.room, r.data.playerId);
  assert.equal(v.me.watch, true); assert.equal(v.me.role, undefined);
  assert.equal(t.room.game.n, 5);
});
