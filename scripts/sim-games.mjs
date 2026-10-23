// Plays whole Quest Night games against a running server with scripted players (no LLM).
// Usage: BASE=http://127.0.0.1:8861 GAMES=30 SEED=1 node scripts/sim-games.mjs   (Node 22+, global WebSocket)
// Checks on every view: secrecy (only your own role, until the end), the rule outcomes, and that games finish.
import { ROLES, QUEST_SIZES, failsNeeded, knowledgeFor } from '../public/js/rules.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8861';
const GAMES = +(process.env.GAMES || 30);
let seed = +(process.env.SEED || 1);
if (!(seed > 0)) { console.error('SEED must be > 0'); process.exit(2); }
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WS = BASE.replace(/^http/, 'ws');
const NAMES = ['Ada', 'Bo', 'Cy', 'Dee', 'Eli', 'Fran', 'Gus', 'Hal', 'Ivy', 'Jo', "O'Neil", 'Zoë <b>', 'Ann-Marie', '李'];

class Seat {
  constructor(code, name, hostKey) { this.code = code; this.name = name; this.hostKey = hostKey; this.view = null; this.errors = []; this.views = 0; }
  open() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(`${WS}/ws/${this.code}`);
      this.ws.onopen = () => this.ws.send(JSON.stringify({ type: 'hello', join: this.name, hostKey: this.hostKey }));
      this.ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === 'joined') { this.id = m.playerId; this.token = m.token; res(); }
        else if (m.type === 'view') { this.view = m.view; this.views++; }
        else if (m.type === 'error') this.errors.push(m.error);
        else if (m.type === 'fatal') rej(new Error(m.error));
      };
      this.ws.onerror = () => rej(new Error('ws error'));
    });
  }
  async reconnect() {
    this.ws.close(); await sleep(30);
    await new Promise((res) => {
      this.ws = new WebSocket(`${WS}/ws/${this.code}`);
      this.ws.onopen = () => this.ws.send(JSON.stringify({ type: 'hello', playerId: this.id, token: this.token }));
      this.ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === 'view') { this.view = m.view; this.views++; res(); } else if (m.type === 'error') this.errors.push(m.error); };
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  close() { try { this.ws.close(); } catch { /* */ } }
}

async function until(fn, what, ms = 4000) {
  const t = Date.now();
  while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(8); }
  throw new Error(`timeout waiting for ${what}`);
}

const problems = [];
const stats = { good: 0, evil: 0, reasons: {}, roles: new Set(), sizes: {} };

async function game(g) {
  const n = 5 + (g % 6);
  const sabP = [0.1, 0.4, 0.8][g % 3];
  const approveP = g % 4 === 3 ? 0.15 : 0.65;
  const settings = { merlin: rnd() < 0.85, percival: rnd() < 0.5, morgana: rnd() < 0.4, mordred: rnd() < 0.35, oberon: rnd() < 0.3 };
  const r = await fetch(`${BASE}/api/create`, { method: 'POST' }).then((x) => x.json());
  const seats = [];
  const used = new Set();
  for (let i = 0; i < n; i++) {
    let nm; do nm = pick(NAMES) + (rnd() < 0.3 ? ` ${i}` : ''); while (used.has(nm.toLowerCase()));
    used.add(nm.toLowerCase());
    const s = new Seat(r.code, nm, i === 0 ? r.hostKey : undefined);
    await s.open(); seats.push(s);
  }
  const host = seats[0];
  const fail = (msg) => { throw new Error(`game ${g} (${n}p ${r.code}): ${msg}`); };
  await until(() => seats.every((s) => s.view?.players.length === n), 'lobby');
  if (!host.view.me.host || seats.slice(1).some((s) => s.view.me.host)) fail('host flag wrong');
  host.send({ type: 'settings', settings });
  await sleep(30);
  // Too many evil roles for small tables: drop optional ones until it deals.
  host.send({ type: 'start' });
  await sleep(60);
  if (host.view.phase === 'lobby') {
    host.send({ type: 'settings', settings: { morgana: false, mordred: false, oberon: false } }); await sleep(30);
    host.send({ type: 'start' });
  }
  await until(() => seats.every((s) => s.view?.phase === 'reveal'), 'reveal');
  // Secrecy + knowledge checks against the true deal (only learnable at the end, so collect now and verify later).
  const mine = Object.fromEntries(seats.map((s) => [s.id, s.view.me.role.id]));
  for (const s of seats) {
    const txt = JSON.stringify(s.view);
    if (s.view.game.roles) fail('roles leaked before the end');
    if (/token|hostKey|"cards":\{/.test(txt)) fail('secret field in a view');
    if (/"votes":\{/.test(txt)) fail('votes object leaked');
  }
  // The shared table screen gets the public view only.
  const scr = await new Promise((res, rej) => { const w = new WebSocket(`${WS}/ws/${r.code}`); w.onopen = () => w.send(JSON.stringify({ type: 'hello', screen: true })); w.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === 'view') { w.close(); res(m.view); } }; w.onerror = () => rej(new Error('screen ws')); });
  if (scr.kind !== 'screen' || /"role":\{|"sees"|"roles":\{|token|hostKey/.test(JSON.stringify(scr))) fail('table screen leak');
  const truthKnow = Object.fromEntries(seats.map((s) => [s.id, knowledgeFor(s.id, mine)]));
  for (const s of seats) if (JSON.stringify(s.view.me.sees) !== JSON.stringify(truthKnow[s.id])) fail(`${s.name} knowledge mismatch`);
  Object.values(mine).forEach((x) => stats.roles.add(x));

  for (const s of seats) s.send({ type: 'ready' });
  await until(() => host.view.phase === 'propose', 'propose');
  if (rnd() < 0.3) await pick(seats).reconnect();

  const side = (id) => ROLES[mine[id]].side;
  const sizes = QUEST_SIZES[n];
  let expectResults = [];
  let rejectsInRow = 0;
  for (let step = 0; step < 60; step++) {
    const v = host.view;
    if (v.phase === 'over' || v.phase === 'assassin') break;
    if (v.phase !== 'propose') fail(`unexpected phase ${v.phase}`);
    const q = v.game.quest;
    const leader = seats.find((s) => s.id === v.game.leader);
    // Leader picks: evil leaders slip a teammate in, good leaders pick at random.
    const pool = seats.map((s) => s.id);
    let team = [];
    if (side(leader.id) === 'evil') team.push(leader.id);
    while (team.length < sizes[q]) { const c = pick(pool); if (!team.includes(c)) team.push(c); }
    // Use pick toggles half the time, the direct form otherwise.
    if (rnd() < 0.5) { for (const id of team) leader.send({ type: 'pick', id }); await until(() => host.view.game.team.length === team.length, 'picks'); leader.send({ type: 'propose' }); }
    else leader.send({ type: 'propose', team });
    await until(() => seats.every((s) => s.view.phase === 'vote'), 'vote');
    const votes = {};
    for (const s of seats) {
      const hasEvil = team.some((id) => side(id) === 'evil');
      let yes = rnd() < (side(s.id) === 'evil' ? (hasEvil ? 0.9 : 0.3) : approveP);
      if (rejectsInRow === 4 && approveP > 0.5) yes = side(s.id) === 'good' ? true : yes;
      votes[s.id] = yes; s.send({ type: 'vote', approve: yes });
    }
    const approvals = Object.values(votes).filter(Boolean).length;
    const passed = approvals * 2 > n;
    await until(() => host.view.game.history.length === v.game.history.length + 1 || host.view.phase === 'over', 'vote result');
    const lv = host.view.game.lastVote;
    if (lv.passed !== passed || lv.approve.length !== approvals) fail('vote tally wrong');
    if (!passed) {
      rejectsInRow++;
      if (rejectsInRow === 5) { await until(() => host.view.phase === 'over', 'over after 5'); if (host.view.game.winner !== 'evil' || host.view.game.reason !== 'rejects') fail('5 rejects should hand the evil the game'); break; }
      await until(() => host.view.phase === 'propose', 'next propose');
      if (host.view.game.leader === leader.id) fail('leader did not rotate');
      continue;
    }
    rejectsInRow = 0;
    await until(() => seats.every((s) => s.view.phase === 'quest'), 'quest');
    // A good servant trying to sabotage must be refused.
    const loyalOn = team.find((id) => side(id) === 'good');
    if (loyalOn) { const s = seats.find((x) => x.id === loyalOn); const before = s.errors.length; s.send({ type: 'play', sabotage: true }); await until(() => s.errors.length > before, 'good sabotage refused'); }
    let fails = 0;
    for (const id of team) {
      const sab = side(id) === 'evil' && rnd() < sabP;
      if (sab) fails++;
      seats.find((s) => s.id === id).send({ type: 'play', sabotage: sab });
    }
    await until(() => host.view.game.results.length === q + 1, 'quest result');
    const want = fails >= failsNeeded(n, q) ? 'fail' : 'success';
    expectResults.push(want);
    if (host.view.game.results[q] !== want) fail(`quest ${q + 1} result ${host.view.game.results[q]} want ${want} (fails ${fails})`);
    if (host.view.game.lastQuest.fails !== fails) fail('fail count wrong');
    await until(() => ['propose', 'assassin', 'over'].includes(host.view.phase), 'after quest');
  }
  let v = host.view;
  if (v.phase === 'assassin') {
    if (!settings.merlin && !Object.values(mine).includes('assassin')) fail('assassin phase without assassin');
    const assassin = seats.find((s) => mine[s.id] === 'assassin');
    if (v.game.assassin !== assassin.id) fail('wrong assassin shown');
    const targets = seats.filter((s) => side(s.id) === 'good');
    const t = rnd() < 0.4 ? targets.find((s) => mine[s.id] === 'merlin') : pick(targets);
    assassin.send({ type: 'strike', id: t.id });
    await until(() => host.view.phase === 'over', 'over after strike');
    v = host.view;
    const w = mine[t.id] === 'merlin' ? 'evil' : 'good';
    if (v.game.winner !== w) fail('strike outcome wrong');
  } else if (v.phase === 'over' && v.game.reason === 'quests') {
    const ok = expectResults.filter((x) => x === 'success').length;
    if (ok >= 3 && Object.values(mine).includes('assassin')) fail('skipped the assassin');
  }
  if (host.view.phase !== 'over') fail(`game did not end (phase ${host.view.phase})`);
  for (const s of seats) { await until(() => s.view.phase === 'over', 'all over'); if (s.view.game.roles[s.id].id !== mine[s.id]) fail('end reveal mismatch'); }
  stats[v.game.winner]++; stats.reasons[v.game.reason] = (stats.reasons[v.game.reason] || 0) + 1; stats.sizes[n] = (stats.sizes[n] || 0) + 1;
  // Play again returns everyone to the lobby.
  host.send({ type: 'again' });
  await until(() => seats.every((s) => s.view.phase === 'lobby'), 'again');
  seats.forEach((s) => s.close());
}

let clean = 0;
for (let g = 0; g < GAMES; g++) {
  try { await game(g); clean++; } catch (e) { problems.push(e.message); console.log('PROBLEM', e.message); }
}
console.log(`games: ${GAMES}, clean: ${clean}, problems: ${problems.length}`);
console.log(`winners: good ${stats.good}, evil ${stats.evil}; reasons ${JSON.stringify(stats.reasons)}; sizes ${JSON.stringify(stats.sizes)}`);
console.log(`roles dealt: ${stats.roles.size} of ${Object.keys(ROLES).length} (${[...stats.roles].sort().join(', ')})`);
process.exit(problems.length ? 1 : 0);
