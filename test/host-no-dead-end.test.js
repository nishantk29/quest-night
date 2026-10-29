// The host flow never dead-ends. ~300 seeded games, tables of 5 to 10, optional roles, Lantern on and off, phone, hybrid
// and physical modes, on rulesVersion 1 and 2. At every step the Host's phone is driven ONLY through hostNav and the
// same room messages the screen sends. Other players act as themselves when the Host chooses to wait for them.
// Checked at every step: the big button is disabled only while a choice is missing and its label names it; every
// disabled step has a skip the room accepts and that moves the game on (the one exception is the Assassin step of a
// rulesVersion 1 room, which has no skip in that version); steps with nothing to choose are enabled; every game ends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { newRoom, reduce, viewForPlayer } from '../public/js/room.js';
import { hostNav } from '../public/js/host-nav.js';
import { roleList, OPTIONAL, MIN_PLAYERS, MAX_PLAYERS } from '../public/js/rules.js';

const NOW = 1_800_000_000_000;
const STEP_BOUND = 400;
const lcg = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (rng, a) => a[Math.floor(rng() * a.length)];
const shuffled = (rng, a) => a.map((x) => [rng(), x]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);

const MODES = [{ play: 'phone' }, { play: 'physical' }];
for (const roles of ['app', 'physical']) for (const votes of ['app', 'physical']) for (const cards of ['app', 'physical']) MODES.push({ play: 'hybrid', roles, votes, cards });
const allPhysical = (m) => m.play === 'physical' || (m.roles === 'physical' && m.votes === 'physical' && m.cards === 'physical');

const stats = { games: 0, steps: 0, skips: 0, byPhase: {}, v1AssassinWait: 0, physicalAssassinSkip: 0, finished: 0 };
const seen = (key) => { stats.byPhase[key] = (stats.byPhase[key] || 0) + 1; };

function setup(g, rng) {
  const n = MIN_PLAYERS + (g % (MAX_PLAYERS - MIN_PLAYERS + 1));
  const mode = MODES[(g * 7 + Math.floor(g / 6)) % MODES.length];
  const room = newRoom('HOSTNV', 'hk');
  const say = (actor, m) => { const r = reduce(room, actor, m, rng, NOW); assert.ok(r.ok, `${m.type}: ${r.error}`); return r; };
  const ids = [];
  const phoneless = allPhysical(mode) && g % 3 === 0 ? Math.min(2, 1 + (g % 2)) : 0;
  for (let i = 0; i < n - phoneless; i++) ids.push(say({}, { type: 'join', name: `P${i}`, hostKey: i === 0 ? 'hk' : undefined }).data.playerId);
  const H = { playerId: ids[0] };
  for (let i = 0; i < phoneless; i++) say(H, { type: 'addSeat', name: `Seat${i}` });
  say(H, { type: 'mode', mode });
  const lantern = g % 2 === 1;
  const sitOut = g % 5 === 4 && n > MIN_PLAYERS && !phoneless;
  say(H, { type: 'house', house: { lantern, sitOut } });
  const seated = n - (sitOut ? 1 : 0);
  let settings = null;
  for (let tries = 0; tries < 20 && !settings; tries++) {
    const s = Object.fromEntries(OPTIONAL.map((k) => [k, rng() < 0.5]));
    if (!roleList(seated, s).error) settings = s;
  }
  if (!settings) return null;
  say(H, { type: 'settings', settings });
  const started = reduce(room, H, { type: 'start' }, rng, NOW);
  if (!started.ok) return null;
  const version = g % 4 < 2 ? 2 : 1; // half the games on version 1: the field is dropped, as in a stored room from before it existed
  if (version === 1) delete room.rulesVersion;
  return { room, H, version, mode, phoneless, sitOut };
}

const progressKey = (room) => JSON.stringify([room.phase, room.game?.quest, room.game?.leader, room.game?.rejects, room.game?.results.length, room.game?.target]);

function playGame(g) {
  const rng = lcg(20261025 + g * 977);
  const c = setup(g, rng);
  if (!c) return false;
  stats.games++;
  const { room, H, version } = c;
  const hostId = H.playerId;
  const ui = { team: [], tally: {}, fails: null, lantern: null, strike: null, hit: null };
  const resetUi = () => Object.assign(ui, { team: [], tally: {}, fails: null, lantern: null, strike: null, hit: null });
  const send = (actor, m) => { const r = reduce(room, actor, m, rng, NOW); assert.ok(r.ok, `game ${g} v${version} ${room.phase}: ${m.type} refused: ${r.error}`); return r; };
  const as = (id) => ({ playerId: id });
  const seats = () => room.players.filter((p) => !p.watch);
  const phoneFolk = () => seats().filter((p) => !p.phoneless);
  const sendNav = (nav) => { assert.ok(!nav.disabled && nav.send, `enabled "${nav.label}" has something to send`); resetUi(); send(H, nav.send); };
  const useSkip = (nav, why) => {
    assert.ok(nav.skip, `game ${g} v${version} ${room.phase}: disabled "${nav.label}" has no skip (${why})`);
    const before = progressKey(room);
    assert.ok(nav.skip.label && nav.skip.msgs.length > 0);
    for (const m of nav.skip.msgs) send(H, m);
    stats.skips++;
    assert.notEqual(progressKey(room), before, `game ${g} v${version}: skip "${nav.skip.label}" did not move the game on`);
    resetUi();
  };

  for (let step = 0; step < STEP_BOUND && room.phase !== 'over'; step++) {
    stats.steps++;
    const view = viewForPlayer(room, hostId);
    const nav = hostNav(view, ui);
    const gm = view.game; const phase = room.phase;
    seen(phase);
    assert.ok(nav, `game ${g} v${version} ${phase}: the Host has a step with no button`);
    assert.equal(nav.disabled, !nav.send, 'disabled exactly when there is nothing to send');
    assert.equal(nav.disabled, !!nav.missing, 'disabled exactly while something is missing');
    const useSkipNow = () => rng() < 0.3;
    const exempt = version === 1 && phase === 'assassin'; // no Assassin skip before rulesVersion 2

    if (!nav.disabled) { sendNav(nav); continue; }
    if (!exempt) assert.ok(nav.skip, `game ${g} v${version} ${phase}: disabled "${nav.label}" has no skip`);

    if (phase === 'propose') {
      const size = gm.sizes[gm.quest];
      if (nav.missing === 'team') {
        assert.match(nav.label, new RegExp(`^Pick ${size - (ui.team.length || gm.team.length)} more for the party$`));
        if (useSkipNow()) { useSkip(nav, 'team'); continue; }
        const pool = seats().map((p) => p.id);
        const leaderIsMe = gm.leader === hostId;
        const open = shuffled(rng, pool).filter((id) => !(leaderIsMe ? gm.team : ui.team).includes(id));
        if (leaderIsMe) send(H, { type: 'pick', id: open[0] }); else ui.team.push(open[0]);
        continue;
      }
      assert.equal(nav.missing, 'leader'); assert.match(nav.label, /^Waiting for .* to choose$/);
      if (useSkipNow()) { useSkip(nav, 'leader'); continue; }
      const lead = room.players.find((p) => p.id === gm.leader);
      assert.ok(!lead.phoneless, 'a phoneless leader is entered by the Host, never waited for');
      for (const id of shuffled(rng, seats().map((p) => p.id)).slice(0, gm.sizes[gm.quest])) send(as(lead.id), { type: 'pick', id });
      send(as(lead.id), { type: 'propose' }); resetUi();
      continue;
    }
    if (phase === 'vote') {
      if (nav.missing === 'tally') {
        assert.equal(nav.label, 'Tap who approved');
        if (useSkipNow()) { assert.equal(nav.skip.label, 'No one approved'); useSkip(nav, 'tally'); continue; }
        const ids = seats().map((p) => p.id);
        const yes = shuffled(rng, ids).slice(0, 1 + Math.floor(rng() * ids.length));
        for (const id of yes) { ui.tally[id] = true; }
        const n2 = hostNav(viewForPlayer(room, hostId), ui);
        assert.equal(n2.disabled, false); assert.match(n2.label, new RegExp(`^Record: ${yes.length} Approve, ${ids.length - yes.length} Reject$`));
        continue;
      }
      assert.equal(nav.missing, 'votes'); assert.match(nav.label, /^Waiting for \d+ votes?$/);
      if (useSkipNow()) { useSkip(nav, 'votes'); continue; }
      const idle = shuffled(rng, phoneFolk().map((p) => p.id).filter((id) => !gm.voted.includes(id)));
      assert.ok(idle.length > 0, 'a vote waits only for people with phones');
      send(as(idle[0]), { type: 'vote', approve: rng() < 0.6 });
      continue;
    }
    if (phase === 'quest') {
      if (nav.missing === 'fails') {
        assert.equal(nav.label, 'Enter the sabotage count');
        if (useSkipNow()) { assert.equal(nav.skip.label, '0 Sabotage'); useSkip(nav, 'fails'); continue; }
        ui.fails = Math.floor(rng() * (gm.team.length + 1));
        const n2 = hostNav(viewForPlayer(room, hostId), ui);
        assert.equal(n2.disabled, false); assert.equal(n2.label, `Record: ${ui.fails} sabotage`);
        continue;
      }
      assert.equal(nav.missing, 'cards'); assert.match(nav.label, /^Waiting for \d+ cards?$/);
      if (useSkipNow()) { useSkip(nav, 'cards'); continue; }
      const idle = gm.team.filter((id) => !gm.played.includes(id));
      send(as(idle[0]), { type: 'play', sabotage: rng() < 0.4 });
      continue;
    }
    if (phase === 'lantern') {
      const L = gm.lantern;
      if (nav.missing === 'lantern' && /^Waiting/.test(nav.label)) {
        if (useSkipNow()) { useSkip(nav, 'lantern'); continue; }
        const holder = room.players.find((p) => p.id === L.holder);
        assert.ok(!holder.phoneless && gm.appRoles, 'a Lantern holder the Host cannot speak for');
        const t = shuffled(rng, seats().map((p) => p.id)).find((id) => id !== L.holder && !L.held.includes(id));
        send(as(holder.id), { type: 'examine', id: t }); resetUi();
        continue;
      }
      assert.equal(nav.missing, 'lantern'); assert.equal(nav.label, 'Choose who to check');
      if (useSkipNow()) { useSkip(nav, 'lantern'); continue; }
      ui.lantern = shuffled(rng, seats().map((p) => p.id)).find((id) => id !== L.holder && !L.held.includes(id));
      const n2 = hostNav(viewForPlayer(room, hostId), ui);
      assert.equal(n2.disabled, false); assert.match(n2.label, /^Check /);
      continue;
    }
    // the Assassin
    assert.equal(phase, 'assassin');
    if (nav.missing === 'assassin') {
      assert.equal(nav.label, 'Waiting for the Assassin');
      if (!exempt && useSkipNow()) { useSkip(nav, 'assassin'); if (room.phase === 'over') seen('assassin-skipped'); continue; }
      if (exempt) stats.v1AssassinWait++;
      const aid = Object.keys(room.game.roles).find((id) => room.game.roles[id] === 'assassin');
      const targets = seats().map((p) => p.id).filter((id) => id !== aid && !gm.evil?.includes(id) && room.game.roles[id] !== 'assassin');
      send(as(aid), { type: 'strike', id: shuffled(rng, targets)[0] });
      continue;
    }
    if (!exempt && useSkipNow()) { if (!gm.appRoles) stats.physicalAssassinSkip++; useSkip(nav, 'assassin'); continue; }
    if (nav.missing === 'strike') {
      assert.match(nav.label, /^Choose who (the Assassin named|to strike)$/);
      const pool = seats().map((p) => p.id).filter((id) => id !== hostId && !gm.evil?.includes(id));
      ui.strike = shuffled(rng, pool)[0];
      continue;
    }
    assert.equal(nav.missing, 'hit'); assert.match(nav.label, /^Say if .* was Merlin$/);
    ui.hit = rng() < 0.5;
    const n2 = hostNav(viewForPlayer(room, hostId), ui);
    assert.equal(n2.disabled, false); assert.match(n2.label, /^Record: /);
  }
  assert.equal(room.phase, 'over', `game ${g} v${version} never ended in ${STEP_BOUND} steps (phase ${room.phase})`);
  stats.finished++;
  return true;
}

test('host flow never dead-ends: ~300 seeded games drive only through hostNav, every missing choice is named and skippable', () => {
  let games = 0;
  for (let g = 0; g < 360; g++) if (playGame(g)) games++;
  assert.ok(games >= 300, `only ${games} games were dealt`);
  assert.equal(stats.finished, stats.games);
  for (const ph of ['reveal', 'propose', 'vote', 'quest', 'lantern', 'assassin']) assert.ok(stats.byPhase[ph] > 20, `${ph} was exercised`);
  assert.ok(stats.skips > 300, 'the skip chips ran');
  assert.ok(stats.v1AssassinWait > 0, 'a rulesVersion 1 Assassin wait ran');
  assert.ok(stats.physicalAssassinSkip > 0, 'a physical Assassin skip ran');
});

test('host flow never dead-ends: steps with nothing to choose are enabled right away', () => {
  const rng = lcg(5);
  const c = setup(0, rng);
  const view = viewForPlayer(c.room, c.H.playerId);
  assert.equal(view.phase, 'reveal');
  const nav = hostNav(view, {});
  assert.equal(nav.disabled, false); assert.equal(nav.label, 'Start the first quest'); assert.deepEqual(nav.send, { type: 'skipReveal' });
  assert.equal(hostNav({ ...view, phase: 'lobby' }, {}), null);
  assert.equal(hostNav({ ...view, kind: 'screen' }, {}), null);
});

test('host flow never dead-ends: the screen uses hostNav for the big button and the skip chip', () => {
  const src = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
  assert.match(src, /from '\.\/host-nav\.js'/);
  assert.match(src, /hostNav\(/);
  assert.match(src, /data-a="dockSkip"/);
});

test('host flow never dead-ends: a physical-play Host names a party for a leader who has a phone, on every version', () => {
  // The screen used to send "pick", which the room only takes from the leader or for a seat without a phone.
  for (const version of [1, 2]) {
    const room = newRoom('HOSTNV', 'hk'); const rng = lcg(11);
    const ids = Array.from({ length: 5 }, (_, i) => reduce(room, {}, { type: 'join', name: `P${i}`, hostKey: i ? undefined : 'hk' }).data.playerId);
    const H = { playerId: ids[0] };
    reduce(room, H, { type: 'mode', mode: { play: 'physical' } });
    assert.ok(reduce(room, H, { type: 'start' }, rng).ok);
    if (version === 1) delete room.rulesVersion;
    room.game.leader = 1; // a leader who is not the Host and has a phone
    reduce(room, H, { type: 'skipReveal' });
    const view = viewForPlayer(room, H.playerId);
    assert.ok(reduce(room, H, { type: 'pick', id: ids[2] }).error, 'the room refuses a pick for a leader with a phone');
    const ui = { team: [ids[2]] };
    assert.equal(hostNav(view, ui).label, 'Pick 1 more for the party');
    ui.team.push(ids[3]);
    const nav = hostNav(view, ui);
    assert.equal(nav.disabled, false);
    assert.ok(reduce(room, H, nav.send).ok);
    assert.equal(room.phase, 'vote'); assert.deepEqual(room.game.team, [ids[2], ids[3]]);
  }
});
