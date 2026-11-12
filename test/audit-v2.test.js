// Logic audit (docs/logic-audit.md): one named test per finding. Rule-affecting fixes are gated on rulesVersion >= 2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newRoom, reduce, viewForPlayer, viewForScreen, gameOverEvent } from '../public/js/room.js';
import { fanout } from '../src/fanout.js';
import { GameLog } from '../public/js/event-log.js';

const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const must = (r) => { assert.ok(r.ok, r.error); return r; };
const act = (room, id, msg, rng, now) => reduce(room, { playerId: id }, msg, rng, now);

function lobby(n, { settings = { merlin: true }, house = {}, seed = 3 } = {}) {
  const rng = seeded(seed); const room = newRoom('ABCDEF', 'hk'); const ids = [];
  for (let i = 0; i < n; i++) ids.push(must(reduce(room, {}, { type: 'join', name: `P${i}`, hostKey: i === 0 ? 'hk' : undefined }, rng)).data.playerId);
  must(act(room, ids[0], { type: 'settings', settings }));
  if (Object.keys(house).length) must(act(room, ids[0], { type: 'house', house }));
  return { room, ids, host: ids[0], rng };
}
function started(n, opts) {
  const t = lobby(n, opts);
  must(act(t.room, t.host, { type: 'start' }, t.rng));
  if (t.room.phase === 'reveal') must(act(t.room, t.host, { type: 'skipReveal' }));
  return t;
}
const roleOf = (t, role) => t.ids.find((id) => t.room.game.roles[id] === role);
// Drive three successful quests so the game reaches the assassin phase (Evil never sabotages here).
function toAssassin(t) {
  const { room } = t;
  for (let q = 0; q < 3; q++) {
    const lead = viewForPlayer(room, t.host).game.leader;
    const size = room.game.sizes[room.game.quest];
    must(act(room, lead, { type: 'propose', team: t.ids.slice(0, size) }));
    for (const id of t.ids) must(act(room, id, { type: 'vote', approve: true }));
    for (const id of t.ids.slice(0, size)) must(act(room, id, { type: 'play', sabotage: false }));
  }
  assert.equal(room.phase, 'assassin');
}

test('percival-order: the two candidates come in a per-game random order, stable within the game', () => {
  const firsts = new Set(); let seatOrder = 0; let n = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const t = started(7, { settings: { merlin: true, percival: true, morgana: true }, seed });
    const p = roleOf(t, 'percival');
    const a = viewForPlayer(t.room, p).me.sees.map((k) => k.id);
    assert.deepEqual(a, viewForPlayer(t.room, p).me.sees.map((k) => k.id), 'stable within the game');
    assert.equal(a.length, 2);
    firsts.add(t.room.game.roles[a[0]]);
    if (t.ids.indexOf(a[0]) < t.ids.indexOf(a[1])) seatOrder++; n++;
  }
  assert.deepEqual([...firsts].sort(), ['merlin', 'morgana'], 'Merlin is not always first, nor Morgana');
  assert.ok(seatOrder > 10 && seatOrder < n - 10, `not seat order (${seatOrder}/${n})`);
});

test('percival-order: the order key never reaches any view', () => {
  const t = started(7, { settings: { merlin: true, percival: true, morgana: true } });
  for (const id of t.ids) assert.ok(!JSON.stringify(viewForPlayer(t.room, id)).includes('"order"'));
  assert.ok(!JSON.stringify(viewForScreen(t.room)).includes('"order"'));
});

test('knowledge-order: Merlin and Evil lists are not in seat order either', () => {
  let seatOrder = 0; let n = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const t = started(10, { settings: { merlin: true }, seed });
    const m = viewForPlayer(t.room, roleOf(t, 'merlin')).me.sees.map((k) => k.id);
    if (m.every((id, i) => i === 0 || t.ids.indexOf(m[i - 1]) < t.ids.indexOf(id))) seatOrder++; n++;
  }
  assert.ok(seatOrder < n * 0.5, `Merlin list sorted by seat ${seatOrder}/${n}`);
});

test('old-game-order: a game dealt before the order key existed still shows its knowledge lists', () => {
  const t = started(7, { settings: { merlin: true, percival: true, morgana: true } });
  delete t.room.game.order; delete t.room.rulesVersion;
  assert.equal(viewForPlayer(t.room, roleOf(t, 'percival')).me.sees.length, 2);
});

test('assassin-phase-oberon: Evil never learn who Oberon is at the strike, and Oberon learns no one', () => {
  const t = started(8, { settings: { merlin: true, oberon: true } });
  toAssassin(t);
  const ob = roleOf(t, 'oberon'); const as = roleOf(t, 'assassin');
  for (const id of t.ids) {
    const g = viewForPlayer(t.room, id).game;
    if (t.room.game.roles[id] === 'oberon') assert.ok(!g.evil && !g.assassin, 'Oberon sees nobody');
    else if (['assassin', 'minion'].includes(t.room.game.roles[id])) {
      assert.ok(!g.evil.includes(ob), 'Oberon is not listed to the team');
      assert.ok(g.evil.includes(id) && g.evil.includes(as) && g.assassin === as);
    } else assert.ok(!g.evil, 'Loyal players see no Evil list');
  }
  assert.ok(!viewForScreen(t.room).game.evil);
});

test('strike-no-oracle: the Assassin may name any other player; a refusal never tells them a side', () => {
  const t = started(8, { settings: { merlin: true, oberon: true } });
  toAssassin(t);
  const as = roleOf(t, 'assassin'); const ob = roleOf(t, 'oberon');
  assert.ok(act(t.room, as, { type: 'strike', id: as }).error, 'not yourself');
  assert.equal(t.room.phase, 'assassin');
  must(act(t.room, as, { type: 'strike', id: ob }));
  assert.equal(t.room.phase, 'over');
  assert.equal(t.room.game.winner, 'good');
});

test('assassin-skip: the host can move an absent Assassin along with a random strike (rulesVersion 2)', () => {
  const t = started(7);
  toAssassin(t);
  assert.ok(act(t.room, t.ids[1], { type: 'skip', id: roleOf(t, 'assassin') }).error, 'host only');
  must(act(t.room, t.host, { type: 'skip', id: roleOf(t, 'assassin') }, seeded(5)));
  assert.equal(t.room.phase, 'over');
  assert.notEqual(t.room.game.target, roleOf(t, 'assassin'));
  assert.ok(t.room.log.some((m) => m.kind === 'host' && /Assassin/.test(m.text)));
});

test('assassin-skip: rooms still on rulesVersion 1 keep the old behaviour', () => {
  const t = started(7); toAssassin(t); delete t.room.rulesVersion;
  assert.ok(act(t.room, t.host, { type: 'skip', id: roleOf(t, 'assassin') }).error);
});

test('assassin-skip: physical roles skip to no strike (the Servants survive); rooms on rulesVersion 1 refuse', () => {
  const t = lobby(7); must(act(t.room, t.host, { type: 'mode', mode: { play: 'physical' } }));
  must(act(t.room, t.host, { type: 'start' }, t.rng)); must(act(t.room, t.host, { type: 'skipReveal' }));
  for (let q = 0; q < 3; q++) {
    const lead = viewForPlayer(t.room, t.host).game.leader; const size = t.room.game.sizes[t.room.game.quest];
    must(act(t.room, t.host, { type: 'propose', team: t.ids.slice(0, size) }));
    must(act(t.room, t.host, { type: 'tally', approve: t.ids })); must(act(t.room, t.host, { type: 'questResult', fails: 0 }));
    void lead;
  }
  assert.equal(t.room.phase, 'assassin');
  const old = JSON.parse(JSON.stringify(t.room)); delete old.rulesVersion;
  assert.ok(act(old, t.host, { type: 'skip' }).error, 'v1 keeps the old behaviour');
  must(act(t.room, t.host, { type: 'skip' }));
  assert.equal(t.room.phase, 'over'); assert.equal(t.room.game.winner, 'good'); assert.equal(t.room.game.reason, 'unstruck'); assert.equal(t.room.game.target, null);
  assert.match(gameOverEvent(t.room).text, /no strike/);
});

test('moderator-view: only a sit-out host sees the deal; a host who rejoined as a watcher does not', () => {
  const t = started(6, { house: { sitOut: true } });
  assert.ok(viewForPlayer(t.room, t.host).moderator, 'sit-out host is the moderator');
  const t2 = started(6);
  // The host's phone died: they rejoin as a late watcher and claim the host key.
  const w = must(reduce(t2.room, {}, { type: 'join', name: 'Back' }, t2.rng)).data.playerId;
  must(act(t2.room, w, { type: 'claimHost', hostKey: 'hk' }));
  assert.ok(byHost(t2.room, w));
  assert.ok(!viewForPlayer(t2.room, w).moderator, 'no deal on a returning host’s phone');
  assert.ok(!viewForPlayer(t2.room, w).me.role);
});
const byHost = (room, id) => room.players.find((p) => p.id === id).host;

test('kicked-socket: after the host opens a seat, the old phone no longer gets views or acts', () => {
  const t = started(5);
  const victim = t.ids[2]; const old = room => room.players.find((p) => p.id === victim).token;
  const att = { who: 'player', playerId: victim, token: old(t.room) };
  const sent = []; const ws = { send: (s) => sent.push(JSON.parse(s)), serializeAttachment() {} };
  fanout(t.room, [{ ws, att }], new Set());
  assert.equal(sent.at(-1).type, 'view');
  must(act(t.room, t.host, { type: 'kick', id: victim }, t.rng));
  fanout(t.room, [{ ws, att }], new Set());
  assert.equal(sent.at(-1).type, 'fatal');
  assert.ok(sent.at(-1).clear);
});

test('reconnect: a fresh view for the same id shows the same private card and own vote', () => {
  const t = started(5);
  const lead = viewForPlayer(t.room, t.host).game.leader;
  must(act(t.room, lead, { type: 'propose', team: t.ids.slice(0, 2) }));
  must(act(t.room, t.ids[1], { type: 'vote', approve: false }));
  const a = JSON.stringify(viewForPlayer(t.room, t.ids[1]));
  assert.equal(a, JSON.stringify(viewForPlayer(JSON.parse(JSON.stringify(t.room)), t.ids[1])));
  assert.equal(JSON.parse(a).me.vote, false);
});

// ---- confirmations: behaviour the audit checked and now pins
const lead = (t) => viewForPlayer(t.room, t.host).game.leader;
const propose = (t, team) => must(act(t.room, lead(t), { type: 'propose', team: team || t.ids.slice(0, t.room.game.sizes[t.room.game.quest]) }));
const voteAll = (t, yes) => t.ids.forEach((id) => must(act(t.room, id, { type: 'vote', approve: typeof yes === 'function' ? yes(id) : yes })));

test('good-never-sabotages: a Loyal phone that sends Sabotage counts as Success, with no error', () => {
  const t = started(5);
  const good = t.ids.filter((id) => t.room.game.roles[id] === 'servant' || t.room.game.roles[id] === 'merlin').slice(0, 2);
  propose(t, good); voteAll(t, true);
  for (const id of good) must(act(t.room, id, { type: 'play', sabotage: true }));
  assert.equal(t.room.game.results[0], 'success');
});

test('five-rejections: the fifth rejection in a row ends the game for Evil; a tie is a rejection', () => {
  const t = started(6);
  for (let i = 0; i < 5; i++) { propose(t); voteAll(t, (id) => t.ids.indexOf(id) < 3); } // 3-3 every time
  assert.equal(t.room.phase, 'over');
  assert.equal(t.room.game.winner, 'evil'); assert.equal(t.room.game.reason, 'rejects');
});

test('quest-four: two sabotage cards are needed at 7+, one at 6', () => {
  for (const [n, want] of [[7, 'success'], [6, 'fail']]) {
    const t = started(n);
    for (let q = 0; q < 3; q++) { // quests 1-3: alternate so nobody has three yet
      const team = t.ids.slice(0, t.room.game.sizes[q]);
      propose(t, team); voteAll(t, true);
      const evil = team.find((id) => t.room.game.roles[id] !== 'servant' && t.room.game.roles[id] !== 'merlin');
      for (const id of team) must(act(t.room, id, { type: 'play', sabotage: q === 1 && id === evil }));
    }
    if (t.room.phase !== 'propose') continue;
    const evils = t.ids.filter((id) => ['assassin', 'minion'].includes(t.room.game.roles[id]));
    const team = [evils[0], ...t.ids.filter((id) => !evils.includes(id))].slice(0, t.room.game.sizes[3]);
    propose(t, team); voteAll(t, true);
    for (const id of team) must(act(t.room, id, { type: 'play', sabotage: id === evils[0] }));
    assert.equal(t.room.game.results[3], want, `${n} players, one sabotage`);
  }
});

test('no-assassin: Good wins at once on three successes when Merlin is off', () => {
  const t = started(5, { settings: { merlin: false } });
  for (let q = 0; q < 3; q++) { propose(t); voteAll(t, true); for (const id of t.room.game.team) must(act(t.room, id, { type: 'play', sabotage: false })); }
  assert.equal(t.room.phase, 'over'); assert.equal(t.room.game.winner, 'good');
});

test('evil-wins-at-once: three failed quests end the game with no strike phase', () => {
  const t = started(5);
  const evils = t.ids.filter((id) => ['assassin', 'minion'].includes(t.room.game.roles[id]));
  for (let q = 0; q < 3; q++) {
    const size = t.room.game.sizes[q];
    propose(t, [evils[0], ...t.ids.filter((id) => !evils.includes(id))].slice(0, size)); voteAll(t, true);
    for (const id of t.room.game.team) must(act(t.room, id, { type: 'play', sabotage: id === evils[0] }));
  }
  assert.equal(t.room.phase, 'over'); assert.equal(t.room.game.winner, 'evil');
});

test('vote-and-card-guards: no double votes, no cards from outside the team, nothing after game over', () => {
  const t = started(5);
  propose(t);
  must(act(t.room, t.ids[0], { type: 'vote', approve: true }));
  assert.ok(act(t.room, t.ids[0], { type: 'vote', approve: false }).error, 'double vote');
  assert.ok(act(t.room, t.ids[1], { type: 'vote', approve: 'yes' }).error, 'non-boolean vote');
  for (const id of t.ids.slice(1)) must(act(t.room, id, { type: 'vote', approve: true }));
  const out = t.ids.find((id) => !t.room.game.team.includes(id));
  assert.ok(act(t.room, out, { type: 'play', sabotage: true }).error, 'non-team card');
  const first = t.room.game.team[0];
  must(act(t.room, first, { type: 'play', sabotage: false }));
  assert.ok(act(t.room, first, { type: 'play', sabotage: true }).error, 'double card');
  t.room.phase = 'over';
  for (const m of [{ type: 'vote', approve: true }, { type: 'play' }, { type: 'propose', team: [] }, { type: 'strike', id: t.ids[1] }, { type: 'skip', id: t.ids[1] }]) assert.ok(act(t.room, t.host, m).error, m.type);
});

test('wrong-size-team: proposals must be exactly the quest size and only seated players', () => {
  const t = started(5);
  assert.ok(act(t.room, lead(t), { type: 'propose', team: t.ids.slice(0, 3) }).error);
  assert.ok(act(t.room, lead(t), { type: 'propose', team: [t.ids[0], 'nobody'] }).error);
  assert.ok(act(t.room, lead(t), { type: 'propose', team: [t.ids[0], t.ids[0]] }).error);
  assert.equal(t.room.phase, 'propose');
});

test('lantern: after quests 2, 3, 4; past holders cannot be examined; it passes; shows true side', () => {
  const t = started(10, { settings: { merlin: true, morgana: true, mordred: true, oberon: true }, house: { lantern: true } });
  const L = () => t.room.game.lantern;
  const first = L().holder;
  const playQuest = (sab) => { propose(t); voteAll(t, true); for (const id of t.room.game.team) must(act(t.room, id, { type: 'play', sabotage: sab && ['morgana', 'mordred', 'oberon'].includes(t.room.game.roles[id]) })); };
  playQuest(false); assert.equal(t.room.phase, 'propose', 'no lantern after quest 1');
  playQuest(false); assert.equal(t.room.phase, 'lantern', 'lantern after quest 2');
  assert.ok(act(t.room, t.ids.find((id) => id !== first), { type: 'examine', id: first }).error, 'only the holder');
  assert.ok(act(t.room, first, { type: 'examine', id: first }).error, 'not yourself');
  const evil = t.ids.find((id) => ['morgana', 'mordred', 'oberon'].includes(t.room.game.roles[id]) && id !== first);
  must(act(t.room, first, { type: 'examine', id: evil }));
  assert.equal(viewForPlayer(t.room, first).me.lanternSeen[0].side, 'evil');
  assert.equal(L().holder, evil);
  for (const id of t.ids) if (id !== first) assert.ok(!viewForPlayer(t.room, id).me.lanternSeen, 'only the holder learns');
  assert.ok(!JSON.stringify(viewForScreen(t.room)).includes('"side":"evil"'));
  if (t.room.phase === 'propose') { playQuest(false); }
  if (t.room.phase === 'lantern') assert.ok(act(t.room, evil, { type: 'examine', id: first }).error, 'past holders are safe');
});

// Undo is a step on the room's event log (event-log.js): the tests drive a GameLog the way the Durable Object does.
function logged(n) {
  const t = started(n); const L = new GameLog(t.room); let k = 0;
  t.room = L.room; t.L = L;
  t.a = (id, msg) => { const r = L.apply({ playerId: id }, msg, 10_000 + k, [k, ++k, 7, 9]); t.room = L.room; return r; };
  return t;
}
test('undo-across-phases: undo steps back through a phase change and restores votes and team', () => {
  const t = logged(5);
  const size = t.room.game.sizes[0];
  must(t.a(lead(t), { type: 'propose', team: t.ids.slice(0, size) }));
  for (const id of t.ids) must(t.a(id, { type: 'vote', approve: true }));
  assert.equal(t.room.phase, 'quest');
  assert.equal(t.L.undoStep(), 'The vote'); t.room = t.L.room;
  assert.equal(t.room.phase, 'vote'); assert.equal(Object.keys(t.room.game.votes).length, 4, 'back to just before the closing vote');
  assert.equal(t.L.undoStep(), 'The party proposal'); t.room = t.L.room;
  assert.equal(t.room.phase, 'propose'); assert.deepEqual(t.room.game.votes, {}); assert.deepEqual(t.room.game.team, []);
});

test('pause: every game action is refused while paused, and works again after resume', () => {
  const t = started(5);
  must(act(t.room, t.host, { type: 'pause' }));
  assert.ok(act(t.room, lead(t), { type: 'propose', team: t.ids.slice(0, 2) }).error);
  must(act(t.room, t.host, { type: 'resume' }));
  propose(t);
});

test('screen-view: the table screen never carries roles, sides, tokens or keys in any phase', () => {
  const t = started(7, { settings: { merlin: true, percival: true, morgana: true } });
  const check = () => { const s = JSON.stringify(viewForScreen(t.room)); assert.ok(!/"hostKey"|"token"|"roles":\{|assassin"?:"p|"evil":\[|lanternSeen|"sees"/.test(s), t.room.phase); assert.ok(!s.includes('hk')); };
  check(); propose(t); check(); voteAll(t, true); check();
  for (const id of t.room.game.team) must(act(t.room, id, { type: 'play', sabotage: true })); check();
  const v = JSON.stringify(viewForPlayer(t.room, t.ids[1]));
  assert.ok(!v.includes('"hostKey"') && !v.includes('"token"') && !v.includes('hk'));
});

test('quest-cards-private: nobody sees who played what; players see counts only', () => {
  const t = started(5);
  propose(t); voteAll(t, true);
  const [a] = t.room.game.team;
  must(act(t.room, a, { type: 'play', sabotage: false }));
  for (const id of t.ids) { const g = viewForPlayer(t.room, id).game; assert.deepEqual(g.played, [a]); assert.ok(!JSON.stringify(g).includes('"cards"')); }
});

test('skip-every-phase: with the leader, a voter, a team member, the Lantern holder and the Assassin all opened, the host can always move on', () => {
  const t = started(7, { house: { lantern: true } });
  const { room } = t; const open = (id) => must(act(room, t.host, { type: 'kick', id }, t.rng));
  const L = room.game.lantern.holder;
  const skipAll = (ids) => ids.forEach((id) => { if (room.phase === 'vote' && id in room.game.votes) return; must(act(room, t.host, { type: 'skip', id })); });
  // propose: opened leader -> crown passes
  const l1 = lead(t); open(l1); must(act(room, t.host, { type: 'skip', id: l1 })); assert.notEqual(lead(t), l1);
  // vote: everyone absent, all skipped
  propose(t); skipAll(t.ids); assert.equal(room.phase, 'propose', 'all-reject skips send the crown on');
  for (let guard = 0; guard < 6 && room.phase !== 'quest'; guard++) { propose(t); voteAll(t, true); }
  assert.equal(room.phase, 'quest');
  skipAll(room.game.team); assert.equal(room.game.results[0], 'success');
  // reach the lantern after quest 2
  propose(t); voteAll(t, true); for (const id of room.game.team) must(act(room, id, { type: 'play', sabotage: false }));
  assert.equal(room.phase, 'lantern'); open(room.game.lantern.holder);
  must(act(room, t.host, { type: 'skip', id: room.game.lantern.holder })); assert.equal(room.phase, 'propose');
  void L;
});

test('undo-after-over: from the end screen the host can go back on purpose; every phone hides the roles again; Play again still works', () => {
  const t = logged(7);
  for (let q = 0; q < 3; q++) {
    const size = t.room.game.sizes[t.room.game.quest];
    must(t.a(lead(t), { type: 'propose', team: t.ids.slice(0, size) }));
    for (const id of t.ids) must(t.a(id, { type: 'vote', approve: true }));
    for (const id of t.ids.slice(0, size)) must(t.a(id, { type: 'play', sabotage: false }));
  }
  assert.equal(t.room.phase, 'assassin');
  must(t.a(roleOf(t, 'assassin'), { type: 'strike', id: t.ids.find((id) => t.room.game.roles[id] === 'servant') || t.ids[1] }));
  assert.equal(t.room.phase, 'over');
  assert.ok(viewForPlayer(t.room, t.ids[1]).game.roles, 'the end screen shows every role');
  assert.deepEqual(act(t.room, t.host, { type: 'undo' }), { error: 'Unknown action.' }, 'the reducer has no Undo of its own');
  assert.ok(t.L.history().canUndo);
  assert.equal(t.L.undoStep(), 'The Assassin’s strike'); t.room = t.L.room;
  assert.equal(t.room.phase, 'assassin');
  for (const id of t.ids) assert.ok(!viewForPlayer(t.room, id).game.roles, 'roles are hidden again');
  assert.deepEqual(t.room.undo, []);
  t.L.redoStep(); t.room = t.L.room; assert.equal(t.room.phase, 'over');
  must(t.a(t.host, { type: 'again' })); assert.equal(t.room.phase, 'lobby', 'Play again still works');
});
