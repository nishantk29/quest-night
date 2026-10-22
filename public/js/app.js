// Quest Night client: routing, the live WebSocket, and every screen. The whole page re-renders on each
// update (same approach as Mafia Night); focus and typed text survive because inputs pause re-renders.
import { ui } from './ui_icons.js';
import { glyph } from './glyphs.js';
import { ROLES, QUEST_SIZES, SHADOW_COUNT, roleList, OPTIONAL } from './rules.js';

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
const $html = document.documentElement;

const S = { mode: 'home', code: null, view: null, prev: null, fatal: null, conn: true, transport: null,
  ui: { showCard: false, flip: false, draft: {}, fresh: {} } };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initial = (n) => esc(([...String(n || '').trim()][0] || '?').toUpperCase());
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* blocked */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* blocked */ } },
};
const send = (a) => S.transport?.send(a);

// ---------------------------------------------------------------- render
let pending = false;
function render() {
  const a = document.activeElement;
  if (a && $app.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox') { pending = true; return; }
  pending = false;
  const y = window.scrollY;
  $html.dataset.phase = S.view?.phase || S.mode;
  $app.innerHTML = screen();
  S.ui.fresh = {}; S.ui.flip = false;
  window.scrollTo(0, y);
}
document.addEventListener('focusout', () => { if (pending) setTimeout(render, 50); });

let toastT;
function toast(m) { $toast.textContent = String(m); $toast.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => $toast.classList.remove('on'), 3200); }

function screen() {
  if (S.fatal) return `<main class="wrap"><div class="empty">${ui('warning')}<h1 class="phase-title">${esc(S.fatal)}</h1><a class="btn" href="#/">Go to the home page</a></div></main>`;
  if (S.mode === 'home') return home();
  if (S.mode === 'rules') return rulesPage();
  const banner = !S.conn ? `<div class="banner" role="status">${ui('wifi-off')} Reconnecting to the room…</div>` : '';
  const v = S.view;
  if (!v) {
    if (store.get(`quest.player.${S.code}`) || S.pendingJoin) return banner + `<main class="wrap"><div class="empty">${glyph('brand')}<p>Riding to the table…</p></div></main>`;
    return banner + joinForm();
  }
  return banner + appbar(v) + `<main class="wrap game">${gameBody(v)}</main>`;
}

const cardBack = () => `<span class="rcard-back"><span class="rcard-back-mark">${glyph('brand')}</span></span>`;

function home() {
  const mine = Object.keys(localStorage).filter((k) => k.startsWith('quest.player.')).map((k) => k.slice(13));
  return `<main class="wrap home">
    <div class="home-hero">
      <div class="card-fan" aria-hidden="true">${cardBack().repeat(3)}</div>
      <h1 class="wordmark">Quest Night <span>A table of knights. A few traitors.</span></h1>
      <p class="lede">Pick a party, vote it through, and see who sabotages the quest. 5 to 10 players, one phone each, nobody has to sit out as moderator.</p>
    </div>
    <div class="home-paths">
      <section class="path"><h2 class="path-title">Host a game</h2>
        <p class="muted">You play too. Everyone else joins with a 6‑letter code.</p>
        <label class="field"><span>Your name</span><input data-i="hostName" maxlength="20" autocomplete="nickname" enterkeyhint="go" value="${esc(S.ui.draft.hostName || store.get('quest.name') || '')}"></label>
        <button type="button" class="btn big" data-a="host">Open a table</button>
        ${mine.map((c) => `<p class="resume-row"><a class="resume" href="#/play/${esc(c)}">Back to table <b class="code">${esc(c)}</b></a></p>`).join('')}</section>
      <section class="path"><h2 class="path-title">Join a game</h2>
        <div class="join-row"><label class="field"><span>Room code</span><input class="code-input" data-i="joinCode" maxlength="6" autocapitalize="characters" autocomplete="off" spellcheck="false" enterkeyhint="go" placeholder="ABCDEF" value="${esc(S.ui.draft.joinCode || '')}"></label>
        <button type="button" class="btn ghost" data-a="goJoin">Join</button></div></section>
      <p class="home-faq"><a class="path-link" href="#/rules">How to play</a></p>
    </div>
    <p class="credits">Same table as <a href="https://mafia-app.hatethespurs.workers.dev">Mafia Night</a>. Icons from <a href="https://game-icons.net" target="_blank" rel="noopener">game-icons.net</a> by Lorc, Delapouite and contributors (<a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener">CC BY 3.0</a>) and <a href="https://phosphoricons.com" target="_blank" rel="noopener">Phosphor</a> (MIT).</p>
  </main>`;
}

function rulesPage() {
  const rows = Object.keys(QUEST_SIZES).map((n) => `<tr><td>${n}</td><td>${n - SHADOW_COUNT[n]} / ${SHADOW_COUNT[n]}</td><td>${QUEST_SIZES[n].map((s, i) => (n >= 7 && i === 3 ? `${s}*` : s)).join(' · ')}</td></tr>`).join('');
  const role = (id, extra) => `<li class="a-${ROLES[id].side}">${glyph(ROLES[id].icon)}<span><b>${ROLES[id].name}</b><small>${esc(extra)}</small></span></li>`;
  return `<main class="wrap game">
    <p><a class="link" href="#/">${ui('back')} Home</a></p>
    <section class="stage"><h1 class="phase-title">How to play</h1>
      <p>Everyone gets a secret card. Most of you are <b>the Loyal</b>. A few are <b>the Shadow</b>, and they know each other.</p>
      <p>Each round a <b>leader</b> (the crown) picks a party for the quest. Everyone votes to approve or reject it, and the votes are shown together. A strict majority sends the party out; otherwise the crown passes left. <b>Five rejected parties in a row and the Shadow wins.</b></p>
      <p>On a quest each member plays a card face down: Loyal must play <b>Success</b>, the Shadow may play <b>Sabotage</b>. One sabotage breaks the quest, except quest 4 at 7+ players, which needs two (marked *).</p>
      <p>Three successful quests and the Loyal win, unless the Seer is in play: then the Assassin gets one last strike, and naming the Seer steals the game.</p>
    </section>
    <section class="stage"><h2 class="block-title">Table sizes</h2>
      <table class="sizes"><thead><tr><th>Players</th><th>Loyal / Shadow</th><th>Quest parties</th></tr></thead><tbody>${rows}</tbody></table></section>
    <section class="stage"><h2 class="block-title">Cards</h2><ul class="roles-list">
      ${role('knight', 'No special knowledge')}${role('seer', 'Sees the Shadow (not the Usurper)')}${role('herald', 'Sees the Seer and the Enchantress, not which is which')}
      ${role('traitor', 'Knows the Shadow')}${role('assassin', 'Last strike at the Seer')}${role('enchantress', 'Looks like the Seer to the Herald')}
      ${role('usurper', 'Hidden from the Seer')}${role('outcast', 'Shadow, but alone and unknown')}</ul></section>
  </main>`;
}

function joinForm() {
  return `<main class="wrap join"><h1 class="phase-title">Join table <span class="code">${esc(S.code)}</span></h1>
    <label class="field"><span>Your name</span><input data-i="joinName" maxlength="20" autocomplete="nickname" enterkeyhint="go" value="${esc(S.ui.draft.joinName || store.get('quest.name') || '')}"></label>
    <button type="button" class="btn big" data-a="join">Take a seat</button>
    <p class="muted" style="margin-top:var(--s4)"><a href="#/">Back</a></p></main>`;
}

const PHASE = { lobby: ['Gathering', 'table'], reveal: ['Secret cards', 'cards'], propose: ['Choosing a party', 'crown'], vote: ['Vote', 'hand'],
  quest: ['On the quest', 'game'], assassin: ['Last strike', 'crosshair'], over: ['Game over', 'trophy'] };
function appbar(v) {
  const [label, icon] = PHASE[v.phase] || ['', 'game'];
  return `<header class="appbar"><a class="appbar-mark" href="#/" aria-label="Home">${glyph('brand')}</a>
    <div class="appbar-title">Table <span class="code">${esc(v.code)}</span></div>
    <span class="phase-badge">${ui(icon)}${label}</span></header>`;
}

const nameOf = (v, id) => v.players.find((p) => p.id === id)?.name || '?';
const names = (v, ids) => ids.map((id) => esc(nameOf(v, id))).join(', ');

function gameBody(v) {
  if (v.phase === 'lobby') return lobby(v);
  const g = v.game;
  return [track(v), roundTable(v), stage(v), lastReveals(v), myCardBlock(v), historyBlock(v)].join('');
}

// ---------------------------------------------------------------- lobby
const OPT_TEXT = {
  seer: ['The Seer and the Assassin', 'The Seer sees the Shadow; the Assassin gets one last strike at them.', 'seer'],
  herald: ['The Herald', 'Knows who might be the Seer.', 'herald'],
  enchantress: ['The Enchantress', 'Looks like the Seer to the Herald. Best with the Herald.', 'enchantress'],
  usurper: ['The Usurper', 'A Shadow the Seer can’t see.', 'usurper'],
  outcast: ['The Outcast', 'A Shadow nobody knows, who knows nobody.', 'outcast'],
};
function lobby(v) {
  const me = v.me; const n = v.players.length;
  const link = `${location.origin}/#/play/${v.code}`;
  const list = roleList(Math.max(5, Math.min(10, n)), v.settings);
  const status = n < 5 ? `<p class="note is-warn">${ui('info')} ${5 - n} more to start (5 to 10 players).</p>`
    : list.error ? `<p class="note is-warn">${ui('warning')} ${esc(list.error)}</p>`
      : `<p class="note">${ui('check')} ${n - SHADOW_COUNT[n]} Loyal and ${SHADOW_COUNT[n]} Shadow. Parties of ${QUEST_SIZES[n].join(', ')}.</p>`;
  const seats = v.players.map((p, i) => `<li><span class="n">${i + 1}</span><span class="dot ${p.online ? 'on' : ''}" title="${p.online ? 'Connected' : 'Not connected'}"></span>
      <span class="who">${esc(p.name)}${p.host ? ' <small class="muted">host</small>' : ''}${p.id === me.id ? ' <small class="muted">you</small>' : ''}</span>
      ${me.host ? `<button class="icon-btn" data-a="move" data-id="${p.id}" data-dir="up" aria-label="Move ${esc(p.name)} up" ${i === 0 ? 'disabled' : ''}>${ui('caret-down', 'flip-up')}</button>
      <button class="icon-btn" data-a="move" data-id="${p.id}" data-dir="down" aria-label="Move ${esc(p.name)} down" ${i === n - 1 ? 'disabled' : ''}>${ui('caret-down')}</button>
      ${p.host ? '' : `<button class="icon-btn" data-a="kick" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">${ui('x')}</button>`}` : ''}</li>`).join('');
  const opts = OPTIONAL.map((k) => { const [t, d, r] = OPT_TEXT[k]; const on = v.settings[k];
    return `<label class="toggle ${on ? 'is-on' : ''} a-${ROLES[r].side}"><input type="checkbox" data-a="set" data-k="${k}" ${on ? 'checked' : ''} ${me.host ? '' : 'disabled'}>${glyph(ROLES[r].icon)}<span><b>${t}</b><span class="muted">${d}</span></span></label>`; }).join('');
  return `<section class="join-code"><p class="muted">Room code</p><p class="room-code">${esc(v.code)}</p>
      <p class="muted join-link">${esc(link)}</p>
      <div class="btn-row"><button class="btn ghost" data-a="copy" data-link="${esc(link)}">${ui('copy')} Copy invite link</button>
      ${navigator.share ? `<button class="btn ghost" data-a="share" data-link="${esc(link)}">Share</button>` : ''}</div></section>
    <section class="stage"><h2 class="block-title">At the table (${n})</h2>
      <p class="muted">Seat order is the order the crown travels. ${me.host ? 'Match it to how you are sitting.' : ''}</p>
      <ul class="seat-list">${seats}</ul>${status}</section>
    <section class="stage"><h2 class="block-title">Special cards</h2>${me.host ? '' : '<p class="muted">The host picks these.</p>'}
      <div class="settings">${opts}</div></section>
    ${me.host ? `<div class="sticky-act"><button class="btn big ${n < 5 || list.error ? 'disabled' : ''}" data-a="start">Deal the cards</button></div>`
    : '<div class="empty">Waiting for the host to deal…</div>'}`;
}

// ---------------------------------------------------------------- game pieces
function track(v) {
  const g = v.game;
  const seals = g.sizes.map((s, i) => {
    const r = g.results[i];
    const cls = r === 'success' ? 'is-success' : r === 'fail' ? 'is-fail' : i === g.quest && v.phase !== 'over' && v.phase !== 'assassin' ? 'is-now' : '';
    const pop = S.ui.fresh.quest && i === g.results.length - 1 ? ' is-pop' : '';
    const inner = r === 'success' ? glyph('grail') : r === 'fail' ? glyph('traitor') : `<b>${s}</b>`;
    return `<div class="seal ${cls}${pop}" aria-label="Quest ${i + 1}: ${r || `${s} knights`}">${inner}${g.needs[i] === 2 ? '<span class="two-fail" title="Needs two sabotage cards to fail">2</span>' : ''}<small>Quest ${i + 1}</small></div>`;
  }).join('');
  const pips = Array.from({ length: g.maxRejects }, (_, i) => `<i class="${i < g.rejects ? 'on' : ''} ${i === g.maxRejects - 1 ? 'last' : ''}"></i>`).join('');
  return `<section class="track" aria-label="Quests"><div class="seals">${seals}</div>
    <div class="seals-legend"><span>${g.results.filter((r) => r === 'success').length} succeeded · ${g.results.filter((r) => r === 'fail').length} failed</span>
    <span class="rejects" title="Rejected parties this quest">Rejected ${pips}</span></div></section>`;
}

function marksFor(v) {
  const g = v.game; const m = {};
  for (const k of v.me.sees || []) m[k.id] = k.tag === 'shadow' ? ['is-shadow', glyph('traitor'), 'Known Shadow'] : ['is-seer', glyph('seer'), 'Seer or Enchantress'];
  if (v.phase === 'vote') for (const id of g.voted) m[id] = ['is-done', ui('check'), 'Has voted'];
  if (v.phase === 'quest') for (const id of g.played) m[id] = ['is-done', ui('check'), 'Has played'];
  if (v.phase === 'reveal') for (const id of g.ready) m[id] = ['is-done', ui('check'), 'Ready'];
  if (v.phase === 'assassin') { for (const id of g.shadow) m[id] = ['is-shadow', glyph('traitor'), 'Shadow']; m[g.assassin] = ['is-shadow', glyph('assassin'), 'Assassin']; }
  if (v.phase === 'over') for (const [id, r] of Object.entries(g.roles)) m[id] = [r.side === 'shadow' ? 'is-shadow' : 'is-seer', glyph(r.icon), r.name];
  return m;
}

function roundTable(v) {
  const g = v.game; const n = v.players.length;
  const meIdx = Math.max(0, v.players.findIndex((p) => p.id === v.me.id));
  const marks = marksFor(v);
  const picking = v.phase === 'propose' && g.leader === v.me.id;
  const striking = v.phase === 'assassin' && g.assassin === v.me.id;
  const seats = v.players.map((p, i) => {
    const ang = Math.PI / 2 + ((i - meIdx) * 2 * Math.PI) / n;
    const x = 50 + 41 * Math.cos(ang); const y = 50 + 41 * Math.sin(ang);
    const onTeam = g.team.includes(p.id);
    const canPick = picking || (striking && !g.shadow.includes(p.id));
    const mk = marks[p.id];
    const tag = canPick ? 'button' : 'div';
    const label = `${p.name}${g.leader === p.id ? ', leader' : ''}${onTeam ? ', on the party' : ''}${mk ? `, ${mk[2]}` : ''}`;
    return `<${tag} class="knight ${p.id === v.me.id ? 'is-me' : ''} ${onTeam ? 'on-team' : ''} ${canPick ? 'can-pick' : ''} ${p.online ? '' : 'is-off'}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%"
      ${canPick ? `type="button" data-a="${striking ? 'strike' : 'pick'}" data-id="${p.id}" aria-pressed="${onTeam}"` : ''} aria-label="${esc(label)}">
      <span class="knight-disc">${initial(p.name)}${g.leader === p.id && v.phase !== 'over' ? `<span class="knight-crown">${glyph('crown')}</span>` : ''}${mk ? `<span class="knight-mark ${mk[0]}" title="${esc(mk[2])}">${mk[1]}</span>` : ''}</span>
      <span class="knight-name">${esc(p.name)}</span></${tag}>`;
  }).join('');
  let felt = '';
  const size = g.sizes[g.quest];
  if (v.phase === 'propose') felt = `<b>${esc(nameOf(v, g.leader))}</b> wears the crown.<br>Party of ${size}: ${g.team.length} chosen`;
  else if (v.phase === 'vote') felt = `${g.voted.length} of ${n} have voted`;
  else if (v.phase === 'quest') felt = `${g.played.length} of ${g.team.length} cards played`;
  else if (v.phase === 'reveal') felt = `${g.ready.length} of ${n} have read their card`;
  else if (v.phase === 'assassin') felt = 'The Shadow stands revealed.';
  else if (v.phase === 'over') felt = g.winner === 'loyal' ? 'The realm is saved.' : 'The Shadow prevails.';
  return `<section class="round" aria-label="The table"><div class="round-felt">${glyph('brand')}<p>${felt}</p></div>${seats}</section>`;
}

function stage(v) {
  const g = v.game; const me = v.me; const size = g.sizes[g.quest];
  const role = me.role;
  if (v.phase === 'reveal') {
    const ready = g.ready.includes(me.id);
    return `<section class="stage"><h1 class="phase-title">Your secret card</h1>
      <p class="say">Shield your screen, tap the card to turn it over, and remember who you are.</p>
      ${cardView(v, true)}
      ${ready ? '<p class="muted center">Waiting for the others to read their cards…</p>' : '<button class="btn big" data-a="ready">I’ve read my card</button>'}
      ${me.host && !ready ? '' : me.host ? '<button class="btn ghost" data-a="skipReveal">Start without waiting</button>' : ''}</section>`;
  }
  if (v.phase === 'propose') {
    if (g.leader !== me.id) return `<section class="stage"><h1 class="phase-title">${esc(nameOf(v, g.leader))} is choosing</h1>
      <p class="say">A party of ${size} for quest ${g.quest + 1}. Argue your case out loud.</p>${g.rejects === g.maxRejects - 1 ? hammer() : ''}</section>`;
    const full = g.team.length === size;
    return `<section class="stage"><h1 class="phase-title">You wear the crown</h1>
      <p class="say">Tap ${size} knights at the table for quest ${g.quest + 1}. You can choose yourself.</p>
      ${g.rejects === g.maxRejects - 1 ? hammer() : ''}
      <div class="sticky-act"><button class="btn big ${full ? '' : 'disabled'}" data-a="propose">${full ? `Put this party to the vote` : `Choose ${size - g.team.length} more`}</button></div></section>`;
  }
  if (v.phase === 'vote') {
    const voted = 'vote' in me;
    return `<section class="stage"><h1 class="phase-title">Send this party?</h1>
      <p class="say">${names(v, g.team)} for quest ${g.quest + 1}, chosen by ${esc(nameOf(v, g.leader))}.</p>
      ${g.rejects === g.maxRejects - 1 ? hammer() : ''}
      ${voted ? `<p class="note">${ui('check')} You voted ${me.vote ? 'approve' : 'reject'}. Votes are shown when everyone is in.</p>`
    : `<div class="choice-pair"><button class="choice yes" data-a="vote" data-v="1">${glyph('up')}Approve</button><button class="choice no" data-a="vote" data-v="0">${glyph('down')}Reject</button></div>`}</section>`;
  }
  if (v.phase === 'quest') {
    const onIt = g.team.includes(me.id);
    if (!onIt) return `<section class="stage"><h1 class="phase-title">The party rides out</h1><p class="say">${names(v, g.team)} are choosing their cards in secret.</p></section>`;
    if (me.played) return `<section class="stage"><h1 class="phase-title">Card played</h1><p class="say">Face down and shuffled in. Waiting for the rest of the party.</p></section>`;
    const loyal = role.side === 'loyal';
    return `<section class="stage"><h1 class="phase-title">Play your card</h1>
      <p class="say">${loyal ? 'You are Loyal. You can only play Success.' : `You serve the Shadow. Sabotage${g.needs[g.quest] === 2 ? ' (this quest needs two to fail)' : ''}, or play it safe.`}</p>
      <div class="choice-pair"><button class="choice success" data-a="play" data-v="0">${glyph('grail')}Success</button>
      <button class="choice sabotage" data-a="play" data-v="1" ${loyal ? 'aria-disabled="true"' : ''}>${glyph('traitor')}Sabotage</button></div></section>`;
  }
  if (v.phase === 'assassin') {
    if (g.assassin === me.id) return `<section class="stage"><h1 class="phase-title">Name the Seer</h1><p class="say">Three quests succeeded. Talk it over with the Shadow, then tap the one you believe is the Seer. You get one strike.</p></section>`;
    return `<section class="stage"><h1 class="phase-title">The Assassin takes aim</h1><p class="say">${esc(nameOf(v, g.assassin))} will name one knight. If it is the Seer, the Shadow wins.</p></section>`;
  }
  if (v.phase === 'over') return over(v);
  return '';
}
const hammer = () => `<p class="note is-out">${ui('warning')} Fifth party this quest. If it is rejected, the Shadow wins.</p>`;

function over(v) {
  const g = v.game; const me = v.me;
  const side = g.winner;
  const why = { rejects: 'Five parties were turned away in a row.', quests: side === 'loyal' ? 'Three quests succeeded.' : 'Three quests were sabotaged.',
    assassin: `The Assassin named ${esc(nameOf(v, g.target))}, the Seer.`, survived: `The Assassin named ${esc(nameOf(v, g.target))}, who was not the Seer.` }[g.reason];
  const won = me.role.side === side;
  const roles = v.players.map((p) => { const r = g.roles[p.id]; return `<li class="a-${r.side}">${glyph(r.icon)}<span><b>${esc(p.name)}</b><small>${esc(r.name)}</small></span></li>`; }).join('');
  return `<section class="winner a-${side}">${glyph(side === 'loyal' ? 'grail' : 'shadow')}<h1>${side === 'loyal' ? 'The Loyal win' : 'The Shadow wins'}</h1>
      <p class="say">${why}</p><p><b>${won ? 'You won.' : 'You lost.'}</b></p></section>
    <section class="stage"><h2 class="block-title">Who was who</h2><ul class="roles-list">${roles}</ul></section>
    ${me.host ? '<div class="sticky-act"><button class="btn big" data-a="again">Play again with this table</button></div>' : '<p class="muted center">The host can start another game.</p>'}`;
}

function lastReveals(v) {
  const g = v.game; const out = [];
  if (g.lastQuest && ['propose', 'assassin', 'over'].includes(v.phase) && g.lastQuest.quest === g.quest - 1 && !(g.lastVote && g.lastVote.quest === g.quest)) {
    const q = g.lastQuest;
    const cards = Array.from({ length: q.size }, (_, i) => (i < q.size - q.fails ? 's' : 'f'));
    out.push(`<section class="reveal ${S.ui.fresh.quest ? 'is-new' : ''}"><h2 class="reveal-h ${q.result === 'success' ? 'ok' : 'bad'}">Quest ${q.quest + 1} ${q.result === 'success' ? 'succeeded' : 'failed'}</h2>
      <div class="flips">${cards.map((c, i) => `<span class="flip ${c}" style="animation-delay:${i * 160}ms">${glyph(c === 's' ? 'grail' : 'traitor')}</span>`).join('')}</div>
      <p class="muted center">${q.fails} sabotage card${q.fails === 1 ? '' : 's'}${q.need === 2 ? ' (two were needed)' : ''}.</p></section>`);
  }
  const lv = g.lastVote;
  if (lv && (v.phase === 'quest' || (v.phase === 'propose' && lv.quest === g.quest) || (v.phase === 'over' && g.reason === 'rejects'))) {
    out.push(`<section class="reveal ${S.ui.fresh.vote ? 'is-new' : ''}"><h2 class="reveal-h ${lv.passed ? 'ok' : 'bad'}">Party ${lv.passed ? 'approved' : 'rejected'} ${lv.approve.length}–${lv.reject.length}</h2>
      <p class="muted">${names(v, lv.team)}, chosen by ${esc(nameOf(v, lv.leader))}.</p>
      <div class="vote-cols"><div class="yes"><h4>Approve</h4><ul>${lv.approve.map((id) => `<li>${esc(nameOf(v, id))}</li>`).join('') || '<li>nobody</li>'}</ul></div>
      <div class="no"><h4>Reject</h4><ul>${lv.reject.map((id) => `<li>${esc(nameOf(v, id))}</li>`).join('') || '<li>nobody</li>'}</ul></div></div></section>`);
  }
  return out.join('');
}

function cardView(v, big) {
  const r = v.me.role; const shown = S.ui.showCard;
  const sees = (v.me.sees || []).map((k) => `<li class="${k.tag === 'shadow' ? 'is-shadow' : 'is-seer'}">${glyph(k.tag === 'shadow' ? 'traitor' : 'seer')}<span><b>${esc(nameOf(v, k.id))}</b> ${k.tag === 'shadow' ? 'serves the Shadow' : 'is the Seer or the Enchantress'}</span></li>`).join('');
  const hint = { seer: 'The Usurper, if dealt, is hidden from you.', herald: 'One of these is the Seer. The other may be the Enchantress.', outcast: 'You know none of the Shadow.' }[r.id] || '';
  const card = `<button type="button" class="rcard-tap" data-a="flip" aria-label="${shown ? 'Hide your card' : 'Show your card'}">
    <div class="rcard a-${r.side} ${S.ui.flip ? (shown ? 'is-flipping' : 'is-unflipping') : ''}" data-face="${shown ? 'front' : 'back'}"><div class="rcard-inner">
      <div class="rcard-face rcard-front"><div class="cardart a-${r.side}">${glyph(r.icon, 'big')}</div>
        <div class="rcard-body"><h2 class="rcard-name">${esc(r.name)}</h2><span class="side-tag a-${r.side}">${esc(r.sideName)}</span><p class="rcard-blurb">${esc(r.blurb)}</p></div></div>
      <div class="rcard-face rcard-back"><span class="rcard-back-mark">${glyph('brand')}</span></div></div></div></button>`;
  return `<div class="hand">${card}${shown && (sees || hint) ? `<ul class="sees">${sees}</ul>${hint ? `<p class="muted">${hint}</p>` : ''}` : ''}${shown ? '' : '<p class="muted">Tap to turn over</p>'}</div>`;
}

function myCardBlock(v) {
  if (v.phase === 'reveal' || v.phase === 'over') return '';
  return `<section class="stage"><h2 class="block-title">Your card</h2>${cardView(v)}</section>`;
}

function historyBlock(v) {
  const g = v.game;
  if (!g.history.length) return '';
  const items = [...g.history].reverse().map((h) => `<li class="${h.passed ? 'ok' : 'bad'}">Quest ${h.quest + 1}, party ${h.attempt}: <b>${esc(nameOf(v, h.leader))}</b> chose ${names(v, h.team)}. ${h.passed ? 'Approved' : 'Rejected'} ${h.approve.length}–${h.reject.length}${h.reject.length ? ` (against: ${names(v, h.reject)})` : ''}.${h.passed && g.results[h.quest] ? ` Quest ${g.results[h.quest] === 'success' ? 'succeeded' : `failed with ${g.questFails[h.quest]} sabotage`}.` : ''}</li>`).join('');
  return `<section class="stage"><h2 class="block-title">The chronicle</h2><ul class="history">${items}</ul>
    ${v.me.host && v.phase !== 'over' ? '<button class="link" data-a="abandon">End this game and go back to the lobby</button>' : ''}</section>`;
}

// ---------------------------------------------------------------- transport
function wsTransport(code) {
  let ws; let closed = false; let tries = 0; let timer;
  const creds = () => { try { return JSON.parse(store.get(`quest.player.${code}`) || 'null'); } catch { return null; } };
  const open = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${code}`);
    ws.onopen = () => { tries = 0; S.conn = true; const c = creds();
      if (c) ws.send(JSON.stringify({ type: 'hello', ...c }));
      else if (S.pendingJoin) { ws.send(JSON.stringify({ type: 'hello', join: S.pendingJoin, hostKey: store.get(`quest.host.${code}`) || undefined })); S.pendingJoin = null; }
      render(); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'view') onView(m.view);
      else if (m.type === 'error') toast(m.error);
      else if (m.type === 'joined') store.set(`quest.player.${code}`, JSON.stringify({ playerId: m.playerId, token: m.token }));
      else if (m.type === 'fatal') { if (m.clear) { store.del(`quest.player.${code}`); S.view = null; toast(m.error); render(); } else { closed = true; S.fatal = m.error; render(); } }
    };
    ws.onclose = () => { if (closed) return; S.conn = false; render(); timer = setTimeout(open, Math.min(8000, 400 * 2 ** tries++)); };
  };
  open();
  return {
    send: (a) => { if (ws?.readyState === 1) ws.send(JSON.stringify(a)); else toast('Not connected to the room yet. Try again in a moment.'); },
    close: () => { closed = true; clearTimeout(timer); ws?.close(); },
  };
}

function onView(v) {
  const p = S.view;
  if (p?.game && v.game) {
    if (v.game.results.length > p.game.results.length) S.ui.fresh.quest = true;
    if (v.game.history.length > p.game.history.length) S.ui.fresh.vote = true;
  }
  if (v.phase === 'reveal' && p?.phase !== 'reveal') S.ui.showCard = false;
  if (v.phase !== 'reveal' && p?.phase === 'reveal') S.ui.showCard = false;
  if (p?.phase !== v.phase && navigator.vibrate && ['vote', 'quest', 'assassin', 'over'].includes(v.phase)) try { navigator.vibrate(30); } catch { /* ignore */ }
  S.view = v; render();
}

// ---------------------------------------------------------------- routing
async function route() {
  S.transport?.close(); S.transport = null; S.view = null; S.fatal = null; S.conn = true; S.ui.showCard = false;
  const [kind, arg] = location.hash.replace(/^#\/?/, '').split('/');
  if ((kind === 'play' || kind === 'join') && /^[A-Za-z]{6}$/.test(arg || '')) {
    S.mode = 'play'; S.code = arg.toUpperCase();
    const ex = await fetch(`/api/room/${S.code}`).then((r) => r.ok).catch(() => false);
    if (!ex) { store.del(`quest.player.${S.code}`); S.fatal = `There’s no table with the code ${S.code}. Check the letters and try again.`; }
    else {
      S.pendingJoin = sessionStorage.getItem('quest.pendingJoin');
      sessionStorage.removeItem('quest.pendingJoin');
      S.transport = wsTransport(S.code);
    }
  } else if (kind === 'rules') S.mode = 'rules';
  else S.mode = 'home';
  render();
}
window.addEventListener('hashchange', route);

const rawSend = (msg) => S.transport?.send(msg);

// ---------------------------------------------------------------- events
$app.addEventListener('input', (e) => { const k = e.target.dataset.i; if (k) S.ui.draft[k] = e.target.value; });
$app.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const k = e.target.dataset.i;
  if (k === 'hostName') act('host'); else if (k === 'joinCode') act('goJoin'); else if (k === 'joinName') act('join');
});
$app.addEventListener('change', (e) => { const el = e.target; if (el.dataset.a === 'set') send({ type: 'settings', settings: { [el.dataset.k]: el.checked } }); });
$app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el || el.dataset.a === 'set') return;
  if (el.getAttribute('aria-disabled') === 'true') { if (el.dataset.a === 'play') toast('The Loyal can only play Success.'); return; }
  act(el.dataset.a, el);
});

async function act(a, el) {
  const d = el?.dataset || {};
  switch (a) {
    case 'host': {
      const name = (S.ui.draft.hostName ?? store.get('quest.name') ?? '').trim();
      if (!name) { toast('Type your name first.'); return; }
      store.set('quest.name', name);
      const r = await fetch('/api/create', { method: 'POST' }).then((x) => x.json()).catch(() => ({ error: 'Could not reach the server.' }));
      if (r.error) { toast(r.error); return; }
      store.set(`quest.host.${r.code}`, r.hostKey);
      sessionStorage.setItem('quest.pendingJoin', name);
      location.hash = `#/play/${r.code}`;
      return;
    }
    case 'goJoin': {
      const c = (S.ui.draft.joinCode || '').trim().toUpperCase();
      if (!/^[A-Z]{6}$/.test(c)) { toast('Room codes are 6 letters.'); return; }
      location.hash = `#/play/${c}`; return;
    }
    case 'join': {
      const name = (S.ui.draft.joinName ?? store.get('quest.name') ?? '').trim();
      if (!name) { toast('Type your name first.'); return; }
      store.set('quest.name', name);
      rawSend({ type: 'hello', join: name, hostKey: store.get(`quest.host.${S.code}`) || undefined }); return;
    }
    case 'copy': try { await navigator.clipboard.writeText(d.link); toast('Invite link copied.'); } catch { toast(d.link); } return;
    case 'share': try { await navigator.share({ title: 'Quest Night', text: 'Join my Quest Night table', url: d.link }); } catch { /* cancelled */ } return;
    case 'flip': S.ui.showCard = !S.ui.showCard; S.ui.flip = true; render(); return;
    case 'start': if (el.classList.contains('disabled')) { toast('Not ready to deal yet.'); return; } send({ type: 'start' }); return;
    case 'propose': if (el.classList.contains('disabled')) { toast('Choose the whole party first.'); return; } send({ type: 'propose' }); return;
    case 'vote': send({ type: 'vote', approve: d.v === '1' }); return;
    case 'play': send({ type: 'play', sabotage: d.v === '1' }); return;
    case 'strike': if (confirm(`Strike ${nameOf(S.view, d.id)}? You only get one.`)) send({ type: 'strike', id: d.id }); return;
    case 'abandon': if (confirm('End this game for everyone?')) send({ type: 'abandon' }); return;
    case 'kick': if (confirm(`Remove ${nameOf(S.view, d.id)} from the table?`)) send({ type: 'kick', id: d.id }); return;
    case 'pick': case 'move': case 'ready': case 'skipReveal': case 'again':
      send({ type: a, id: d.id, dir: d.dir }); return;
    default:
  }
}

route();
if ('serviceWorker' in navigator && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
