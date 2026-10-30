// What the big button at the bottom of a phone does in each phase. Pure: no DOM, no state. app.js renders it and sends
// what it says, so tests can drive a whole game through it. Every step that needs a choice shows a greyed button that
// names the missing choice, and the Host always has a skip that takes the most neutral way on.
// hostNav(view, ui) -> null (nothing for this phone to decide) or
//   { label, disabled, missing, send, skip }
//   missing: what is still needed ('team', 'leader', 'tally', 'votes', 'cards', 'fails', 'lantern', 'strike', 'hit', 'assassin') or null
//   send:    the room message Next sends when enabled (null while disabled)
//   skip:    { label, action, msgs } or null; msgs are the room messages the chip sends, in order
// ui: { team: [ids], tally: {id: bool}, fails: n|null, lantern: id|null, strike: id|null, hit: bool|null }
const plural = (n, one, many) => (n === 1 ? one : many);
const nameOf = (v, id) => v.players.find((p) => p.id === id)?.name || 'someone';

export function hostNav(view, uiIn = {}) {
  const g = view.game; const me = view.me;
  if (!g || !me || view.kind === 'screen' || !['reveal', 'propose', 'vote', 'quest', 'lantern', 'assassin'].includes(view.phase)) return null;
  const ui = { team: [], tally: {}, fails: null, lantern: null, strike: null, hit: null, ...uiIn };
  const host = !!me.host;
  const seats = view.players.filter((p) => !p.watch);
  const seatIds = seats.map((p) => p.id);
  const v2 = (view.rulesVersion || 1) >= 2;
  const skipMsg = (id) => (id ? { type: 'skip', id } : { type: 'skip' });
  const waiting = (label, missing, skip) => ({ label, disabled: true, missing, send: null, skip: host ? skip : null });
  const need = (label, missing, skip) => ({ label, disabled: true, missing, send: null, skip: host ? skip : null });
  const ready = (label, send) => ({ label, disabled: false, missing: null, send, skip: null });

  if (view.phase === 'reveal') return host ? ready('Start the first quest', { type: 'skipReveal' }) : null;

  if (view.phase === 'propose') {
    const size = g.sizes[g.quest];
    const lead = seats.find((p) => p.id === g.leader);
    const mine = g.leader === me.id;
    const forLeader = host && !mine && (lead?.phoneless || view.mode.play === 'physical');
    const pass = { label: 'Pass the crown', action: 'skip', msgs: [skipMsg()] };
    if (!mine && !forLeader) return host ? waiting(`Waiting for ${nameOf(view, g.leader)} to choose`, 'leader', pass) : null;
    const team = (forLeader ? ui.team : g.team).filter((id) => seatIds.includes(id));
    const left = size - team.length;
    if (left > 0) return need(`Pick ${left} more for the party`, 'team', pass);
    return ready('Start vote', { type: 'propose', team });
  }

  if (view.phase === 'vote') {
    if (view.mode.votes === 'physical') {
      if (!host) return null;
      const yes = seatIds.filter((id) => ui.tally[id]);
      const none = { label: 'No one approved', action: 'tally', msgs: [{ type: 'tally', approve: [] }] };
      if (!yes.length) return need('Tap who approved', 'tally', none);
      return ready(`Record: ${yes.length} Approve, ${seatIds.length - yes.length} Reject`, { type: 'tally', approve: yes });
    }
    const idle = seatIds.filter((id) => !g.voted.includes(id));
    if (!host || !idle.length) return null;
    return waiting(`Waiting for ${idle.length} ${plural(idle.length, 'vote', 'votes')}`, 'votes',
      { label: 'Skip the rest', action: 'skip', msgs: idle.map(skipMsg) });
  }

  if (view.phase === 'quest') {
    if (!host) return null;
    if (view.mode.cards === 'physical') {
      const none = { label: '0 Sabotage', action: 'questResult', msgs: [{ type: 'questResult', fails: 0 }] };
      if (ui.fails == null) return need('Enter the sabotage count', 'fails', none);
      return ready(`Record: ${ui.fails} sabotage`, { type: 'questResult', fails: ui.fails });
    }
    const idle = g.team.filter((id) => !g.played.includes(id));
    if (!idle.length) return null;
    return waiting(`Waiting for ${idle.length} ${plural(idle.length, 'card', 'cards')}`, 'cards',
      { label: 'Skip the rest', action: 'skip', msgs: idle.map(skipMsg) });
  }

  if (view.phase === 'lantern') {
    const L = g.lantern; if (!L) return null;
    const holder = view.players.find((p) => p.id === L.holder);
    const mine = L.holder === me.id;
    const forHolder = host && !mine && (!g.appRoles || holder?.phoneless);
    const skip = { label: 'Skip the lantern', action: 'skip', msgs: [skipMsg()] };
    if (!mine && !forHolder) return host ? waiting(`Waiting for ${nameOf(view, L.holder)} to choose`, 'lantern', skip) : null;
    const t = ui.lantern && seatIds.includes(ui.lantern) && ui.lantern !== L.holder && !L.held.includes(ui.lantern) ? ui.lantern : null;
    if (!t) return need('Choose who to check', 'lantern', skip);
    return ready(`Check ${nameOf(view, t)}`, { type: 'examine', id: t });
  }

  // assassin
  const skipA = v2 ? { label: 'Skip the assassin', action: 'skip', msgs: [skipMsg()] } : null;
  if (!g.appRoles) {
    if (!host) return null;
    const t = ui.strike && seatIds.includes(ui.strike) ? ui.strike : null;
    if (!t) return need('Choose who the Assassin named', 'strike', skipA);
    if (ui.hit == null) return need(`Say if ${nameOf(view, t)} was Merlin`, 'hit', skipA);
    return ready(`Record: ${nameOf(view, t)} ${ui.hit ? 'was Merlin' : 'was not Merlin'}`, { type: 'strikeResult', id: t, hit: !!ui.hit });
  }
  if (g.assassin === me.id) {
    const t = ui.strike && seatIds.includes(ui.strike) && ui.strike !== me.id && !g.evil?.includes(ui.strike) ? ui.strike : null;
    if (!t) return need('Choose who to strike', 'strike', skipA);
    return ready(`Strike ${nameOf(view, t)}`, { type: 'strike', id: t });
  }
  return host ? waiting('Waiting for the Assassin', 'assassin', skipA) : null;
}
