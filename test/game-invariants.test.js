// Quest Night adapter for the shared game-rules kit (test/kit/game-invariants.mjs, copied unchanged from
// the shared kit). Four properties over seeded games, every table size 5..10, the optional
// roles and the Lantern: game over stays final, no step can block, no leaks (non-interference), no Undo after game over.
// The Undo one was a known bug until the logic audit (Undo on the end screen re-opened a finished game with every role revealed);
// the reducer now refuses it, so the gate enforces it.
import { gameInvariantTests, pick } from './kit/game-invariants.mjs';
import { newRoom, reduce, viewForPlayer } from '../public/js/room.js';
import { roleList, knowledgeFor, shuffle, sideOf, QUEST_SIZES, MIN_PLAYERS, MAX_PLAYERS } from '../public/js/rules.js';

const HOST_KEY = 'kit-host';
const GAMES = Number(process.env.KIT_GAMES) || 240;
const SETS = [
  { merlin: true }, { merlin: true, percival: true, morgana: true }, { merlin: true, percival: true, morgana: true, mordred: true },
  { merlin: true, percival: true, morgana: true, mordred: true, oberon: true }, { merlin: true, oberon: true }, { merlin: false },
];
const CASES = [];
for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) for (const s of SETS) for (const lantern of [false, true]) {
  const settings = { merlin: false, percival: false, morgana: false, mordred: false, oberon: false, ...s };
  if (!roleList(n, settings).error) CASES.push({ n, settings, lantern });
}

const seats = (room) => room.players.filter((p) => !p.watch).map((p) => p.id);
const host = (room) => ({ playerId: room.players.find((p) => p.host).id });
const as = (id) => ({ playerId: id });

const adapter = {
  name: 'Quest Night',
  cases: CASES,
  setup(c, rng) {
    const room = newRoom('KIT', HOST_KEY);
    for (let i = 0; i < c.n; i++) reduce(room, {}, { type: 'join', name: `P${i}`, hostKey: i === 0 ? HOST_KEY : undefined }, rng, 0);
    const H = host(room);
    reduce(room, H, { type: 'house', house: { lantern: c.lantern } }, rng, 0);
    reduce(room, H, { type: 'settings', settings: c.settings }, rng, 0);
    const res = reduce(room, H, { type: 'start' }, rng, 0);
    if (!res.ok) throw new Error(`setup did not deal: ${res.error}`);
    return room;
  },
  apply(room, actor, msg, rng, now) { const res = reduce(room, actor, msg, rng, now); return { ok: !!res.ok, state: room }; },
  isOver: (room) => room.phase === 'over',
  progress(room, rng) {
    const g = room.game; const ids = seats(room); const H = host(room);
    switch (room.phase) {
      case 'reveal': return ids.filter((id) => !g.ready[id]).map((id) => [as(id), { type: 'ready' }]);
      case 'propose': { const leader = ids[g.leader % g.n]; return [[as(leader), { type: 'propose', team: shuffle(ids, rng).slice(0, QUEST_SIZES[g.n][g.quest]) }]]; }
      case 'vote': return ids.filter((id) => !(id in g.votes)).map((id) => [as(id), { type: 'vote', approve: rng() < 0.6 }]);
      case 'quest': return g.team.filter((id) => !(id in g.cards)).map((id) => [as(id), { type: 'play', sabotage: rng() < 0.4 }]);
      case 'lantern': { const L = g.lantern; return ids.filter((x) => x !== L.holder && !L.held.includes(x)).map((x) => [as(L.holder), { type: 'examine', id: x }]); }
      case 'assassin': { const asn = ids.find((k) => g.roles[k] === 'assassin'); return [[as(asn), { type: 'strike', id: pick(rng, ids.filter((x) => x !== asn)) }]]; }
      default: return [[H, { type: 'nonsense' }]];
    }
  },
  fallback(room) {
    const g = room.game; const ids = seats(room); const H = host(room);
    switch (room.phase) {
      case 'reveal': return [H, { type: 'skipReveal' }];
      case 'propose': return [H, { type: 'skip', id: ids[g.leader % g.n] }];
      case 'vote': return [H, { type: 'skip', id: ids.find((id) => !(id in g.votes)) }];
      case 'quest': return [H, { type: 'skip', id: g.team.find((id) => !(id in g.cards)) }];
      case 'lantern': return [H, { type: 'skip', id: g.lantern.holder }];
      case 'assassin': return [H, { type: 'skip' }];
      default: return null;
    }
  },
  probes(room, rng) {
    const ids = seats(room); const H = host(room); const p = as(pick(rng, ids)); const other = pick(rng, ids);
    return [[p, { type: 'ready' }], [H, { type: 'skipReveal' }], [p, { type: 'propose', team: ids.slice(0, 3) }], [p, { type: 'vote', approve: true }],
      [H, { type: 'tally', approve: ids }], [p, { type: 'play', sabotage: true }], [H, { type: 'questResult', fails: 1 }], [p, { type: 'examine', id: other }],
      [p, { type: 'strike', id: other }], [H, { type: 'strikeResult', id: other, hit: true }], [H, { type: 'skip', id: other }], [H, { type: 'skip' }],
      [p, { type: 'pick', id: other }]];
  },
  // The reducer has no Undo of its own any more (Undo and Redo are steps on the event log, see undo-redo.test.js),
  // so the kit's "no Undo after game over" check sees the reducer refuse it. Going back from the end screen on purpose
  // is allowed through the log, with a confirm sheet (RULES.md R21).
  undo: (room) => [host(room), { type: 'undo' }],
  fingerprint: (room) => JSON.stringify({ phase: room.phase, game: room.game }),
  viewers: (room) => room.players.map((p) => p.id),
  view: (room, id) => viewForPlayer(room, id),
  secretsRevealed: (room) => room.phase === 'over',
  secretHolders: (room) => (room.game?.roles ? seats(room) : []),
  withSecrets(room, mapping) {
    const r = structuredClone(room); const old = room.game.roles;
    for (const [id, from] of Object.entries(mapping)) r.game.roles[id] = old[from];
    return r;
  },
  // What a viewer may legitimately tell apart: the "who you see" tags on their card, the sides their Lantern showed, and
  // in the Assassin's turn, which known teammate is the Assassin. Everything else must look the same.
  knowledgeClass(room, viewer, other) {
    const g = room.game; const me = room.players.find((p) => p.id === viewer);
    if (!me || me.watch || !g.roles[viewer]) return me?.host && me.watch && room.house.sitOut ? null : 'all';
    const tag = knowledgeFor(viewer, g.roles, g.order).find((k) => k.id === other)?.tag || '-';
    const lantern = (g.lantern?.seen[viewer] || []).find((e) => e.id === other)?.side || '-';
    const asn = room.phase === 'assassin' && sideOf(g.roles[viewer]) === 'evil' && g.roles[viewer] !== 'oberon' && tag === 'evil' && g.roles[other] === 'assassin';
    return `${tag}|${lantern}|${asn ? 'assassin' : ''}`;
  },
};

gameInvariantTests(adapter, {
  games: GAMES,
});
