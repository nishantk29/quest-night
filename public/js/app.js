// Quest Night client: routing, the live WebSocket, and every screen. The whole page re-renders on each
// update (same approach as Mafia Night); focus and typed text survive because inputs pause re-renders.
// Table things (chat, log, tools, host dashboard frame) come from table_ui.js.
import { ui } from './ui_icons.js';
import { hostNav } from './host-nav.js';
import { glyph } from './glyphs.js';
import { art } from './art.js';
import { ROLES, QUEST_SIZES, EVIL_COUNT, roleList, MIN_PLAYERS, MAX_PLAYERS, LANTERN_AFTER } from './rules.js';
import { makeTable, faqPage, wireFaqSearch } from './table_ui.js';
import { roleCards, ROLE_CARD, PIECES as CARD_PIECES } from './cards.js';
import { FAQ } from './faq.js';
import { fx, dur } from './fx.js';
import { createReveal } from './reveal.js';
import { wakeReconnect } from './wake.js';
import { haptic, createWakeLock, wantsWakeLock, canFullscreen, enterFullscreen } from './device.js';
import { screenKey, canTransition } from './motion.js';
import { qrSvg } from './qr.js';
import { pruneClosedRooms } from './flair.js';
import { rolesInGame, rolesSeats, rolesSheetBody } from './roles_sheet.js';
import { setupSteppers, stepMessage } from './steppers.js';
import { openSheet, closeSheets } from './sheets.js';
import { rolesPanelHtml, rolesButtonLabel } from './roles_sheet.js';
import { carousel, presetsPage, customizePage, previewBody } from './setup_ui.js';
import { setupState, defaultSeating, modeFor, loadSetup, saveSetup, clampStep, firstBlocked } from './setup.js';
import { allPresets, findPreset, presetSettings, savedPreset, misfit, fits } from './presets.js';
import { SAVED_PRESETS_KEY, SAVED_PRESETS_MAX, SLIDE_MS, FADE_MS, SWIPE_PX, SETUP_STEPS } from './config-defaults.js';
import { errorBody, errorButtons, crashHtml, FATAL, ENDED } from './error-screen.js';

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
const $html = document.documentElement;
const KEY = 'quest';

const S = { mode: 'home', code: null, view: null, fatal: null, conn: true, transport: null,
  ui: { showCard: false, flip: false, draft: {}, fresh: {}, tab: 'game', side: 'chat', tally: {}, team: [], fails: null, lantern: null, strike: null, hit: null } };
// Setup carousel state (host only). Progress lives in localStorage (quest.setup.v1) so a refresh lands on the same step.
const loadSaved = () => { try { const a = JSON.parse(localStorage.getItem(SAVED_PRESETS_KEY)); return Array.isArray(a) ? a.filter((x) => x && typeof x.id === 'string' && typeof x.name === 'string') : []; } catch { return []; } };
S.saved = loadSaved(); S.setup = null; S.page = 'carousel';
const persistSaved = () => store.set(SAVED_PRESETS_KEY, JSON.stringify(S.saved));
const persistSetup = () => S.setup && saveSetup({ getItem: (k) => store.get(k), setItem: (k, v) => store.set(k, v) }, S.setup);
const resetChoices = () => Object.assign(S.ui, { tally: {}, team: [], fails: null, lantern: null, strike: null, hit: null });

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initial = (n) => esc(([...String(n || '').trim()][0] || '?').toUpperCase());
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* blocked */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* blocked */ } },
};
const send = (a) => S.transport?.send(a);
let toastT;
function toast(m) { $toast.textContent = String(m); $toast.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => $toast.classList.remove('on'), 3200); }

// ---------------------------------------------------------------- render
let pending = false; let lastKey = null; let vtBusy = false;
// A repaint between a tap's pointerdown and the focus it causes would swallow the tap (the room code box "won't focus"),
// so repaints wait while a finger or button is down on a text field.
let fieldDown = false;
// A button tapped while a text field has focus blurs the field first; without this hold the repaint would replace the button before the tap lands.
addEventListener('pointerdown', (e) => { if (e.target.closest?.('input,textarea,select,label.field') || (e.target.closest?.('#app button') && document.activeElement?.matches?.('input,textarea'))) fieldDown = true; }, true);
addEventListener('pointerup', () => { if (!fieldDown) return; setTimeout(() => { fieldDown = false; if (pending) render(); }, 350); }, true);
addEventListener('pointercancel', () => { fieldDown = false; }, true);
let toTop = false;
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; // hash routes must not restore an old offset
function render() {
  const a = document.activeElement;
  if (fieldDown) { pending = true; return; }
  if (a && $app.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'radio') { pending = true; return; }
  pending = false;
  if (vtBusy) return; // the pending transition paints the latest state when it starts
  const key = screenKey(S);
  if (lastKey !== null && key !== lastKey) toTop = true; // a new screen (the deal, a new phase) opens at the top, card in view
  // The room's first view replacing the connecting placeholder is the same screen: no second slide right after the first.
  const settling = lastKey !== null && lastKey.endsWith('|wait') && lastKey.split('|')[0] === key.split('|')[0];
  const animate = lastKey !== null && key !== lastKey && !settling && fx.enabled() && canTransition();
  lastKey = key;
  if (!animate) { paint(); return; }
  vtBusy = true;
  // If the browser never calls back (tab hidden mid-transition), paint anyway so the screen can't freeze.
  let painted = false; const once = () => { if (painted) return; painted = true; vtBusy = false; paint(); };
  const guard = setTimeout(once, 500);
  try {
    const vt = document.startViewTransition(() => { clearTimeout(guard); once(); });
    // An aborted transition (e.g. viewport resized mid-animation) rejects these; the DOM update still runs via once().
    for (const p of [vt.ready, vt.updateCallbackDone, vt.finished]) p.catch(() => {});
  } catch { clearTimeout(guard); once(); }
}
const TITLES = { home: 'Quest Night', rules: 'How to play | Quest Night', faq: 'Rules & FAQ | Quest Night', screen: 'Table Screen | Quest Night' };
function paint() {
  document.title = S.ended ? 'Game ended | Quest Night' : S.mode === 'play' && S.code ? `Table ${S.code} | Quest Night` : TITLES[S.mode] || 'Quest Night';
  const y = window.scrollY;
  $html.dataset.phase = S.view?.phase || S.mode;
  $html.dataset.screen = S.mode === 'screen' ? '1' : '';
  try { $app.innerHTML = screen(); } catch (e) { console.error(e); crash(); return; }
  S.ui.fresh = {}; S.ui.flip = false;
  // Same screen: keep the reader's place. New screen: start at the top (Nishant 2026-10-28: "open to the top", card still hidden).
  window.scrollTo(0, toTop ? 0 : y); toTop = false;
  fx.after($app);
  afterSetupPaint();
  for (const el of $app.querySelectorAll('[data-scroll]')) el.scrollTop = el.scrollHeight;
  wake.set(wantsWakeLock(S.view));
  if (S.mode === 'home' && !S.pruned) { S.pruned = true; pruneClosedRooms($app, (c) => { store.del(`${KEY}.player.${c}`); store.del(`${KEY}.host.${c}`); }); }
}
const wake = createWakeLock();
document.addEventListener('focusout', () => { if (pending) setTimeout(render, 50); });
const OWN_ICONS = ['table', 'crown']; // tab-bar icons drawn for Quest Night instead of the stock set
const T = makeTable({ S, send, esc, ui: (n, c) => (OWN_ICONS.includes(n) ? art(n, c) : ui(n, c)), toast, render });

// The one client error screen: title + short line + the two home buttons. Fixed words only, never raw error text.
const errorScreen = ({ title, line, icon = 'warning' }) => errorBody({ title, line, icon: icon === 'crown' ? art('crown') : ui(icon, 'is-big') });
function crash() {
  try { $html.dataset.phase = 'home'; $app.innerHTML = crashHtml(); } catch { /* nothing more to do */ }
}
const nothingShown = () => !$app.querySelector('main,.layout,.appbar');
addEventListener('error', (ev) => { if (nothingShown()) crash(); });
addEventListener('unhandledrejection', (ev) => { if (nothingShown()) crash(); });

function screen() {
  if (S.ended) return errorScreen({ ...ENDED.host, icon: 'crown' });
  if (S.fatal) return errorScreen(S.fatal);
  if (S.mode === 'home') return home();
  if (S.mode === 'rules') return rulesPage() + siteFooter();
  if (S.mode === 'faq') return faqPage(FAQ, esc, ui, 'Rules & FAQ') + siteFooter();
  const banner = !S.conn ? `<div class="banner${S.connLong ? ' banner-lost' : ''}" role="status">${ui('wifi-off')} Reconnecting… Your seat and role are kept.${S.connLong ? errorButtons() : ''}</div>` : '';
  const v = S.view;
  if (!v) {
    if (S.mode === 'screen' || store.get(`${KEY}.player.${S.code}`) || S.pendingJoin) return banner + `<main class="wrap"><div class="empty">${art('table')}<p>Riding to the table…</p></div></main>`;
    return banner + joinForm();
  }
  if (v.kind === 'screen') return banner + tableScreen(v);
  return banner + appbar(v) + layout(v);
}

const HUB = 'https://gamenight.hatethespurs.com/';
const MORE_GAMES = [
  { cls: 'more-mafia', name: 'Mafia Night', href: 'https://mafia.hatethespurs.com', blurb: 'Secret roles for Mafia and Werewolf, dealt to every phone.',
    logo: '<svg viewBox="0 0 48 48"><path d="M8 20c4-8 11-10 16-6 5-4 12-2 16 6-3 12-9 19-16 19S11 32 8 20z" fill="currentColor"/><ellipse cx="17" cy="22" rx="4.4" ry="2.6" fill="#1B1410"/><ellipse cx="31" cy="22" rx="4.4" ry="2.6" fill="#1B1410"/></svg>' },
  { cls: 'more-gilded', name: 'The Gilded Chamber', href: 'https://secrethitler.hatethespurs.com', blurb: 'Elect a Chancellor. Pass laws. Find the traitor.',
    logo: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="8" fill="currentColor"/><g stroke="currentColor" stroke-width="3" stroke-linecap="round">' + Array.from({ length: 12 }, (_, i) => { const a = i * Math.PI / 6; return `<path d="M${(24 + 13 * Math.cos(a)).toFixed(1)} ${(24 + 13 * Math.sin(a)).toFixed(1)}L${(24 + 20 * Math.cos(a)).toFixed(1)} ${(24 + 20 * Math.sin(a)).toFixed(1)}"/>`; }).join('') + '</g></svg>' },
];
const HUB_LOGO = '<svg viewBox="0 0 48 48"><rect x="7" y="7" width="15" height="15" rx="4" fill="currentColor"/><rect x="26" y="7" width="15" height="15" rx="4" fill="currentColor"/><rect x="7" y="26" width="15" height="15" rx="4" fill="currentColor"/><rect x="26" y="26" width="15" height="15" rx="4" fill="currentColor" opacity=".5"/></svg>';

// One footer for every page: the game links, then the licences tucked behind "Credits".
function siteFooter() {
  return `<footer class="site-foot"><nav aria-label="Game Night games"><a href="${HUB}">All Games</a><a href="https://mafia.hatethespurs.com">Mafia Night</a><a href="https://secrethitler.hatethespurs.com">The Gilded Chamber</a><a href="https://avalon.hatethespurs.com" aria-current="page">Quest Night</a></nav>
    <details class="credits-box"><summary>Credits</summary><p>Crown, chalice, lantern and crest icons drawn for Quest Night. Role icons from <a href="https://game-icons.net" target="_blank" rel="noopener">game-icons.net</a> by Lorc, Delapouite and contributors (CC BY 3.0). Interface icons from <a href="https://phosphoricons.com" target="_blank" rel="noopener">Phosphor</a> (MIT). Fonts Rubik and Cinzel (SIL OFL 1.1).</p></details></footer>`;
}
const CHEV_L = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const CHEV = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

function home() {
  const mine = Object.keys(localStorage).filter((k) => k.startsWith(`${KEY}.player.`)).map((k) => k.slice(KEY.length + 8));
  // a sample quest track at 5 players: seal size follows party size, the last two show their quest's party size
  const seals = QUEST_SIZES[5].map((n, i) => `<span class="hseal ${['ok', 'bad', 'ok', 'now', 'wait'][i]}" style="--n:${n}">${i < 3 ? art(['chalice', 'broken', 'chalice'][i]) : n}</span>`).join('');
  return `<main class="wrap home">
    <nav class="home-nav" aria-label="Game Night"><a class="hub-link" href="${HUB}">${CHEV_L}All Games</a></nav>
    <div class="home-hero">
      <div class="home-brand"><span class="logo-mark" aria-hidden="true">${art('crown')}</span>
        <h1 class="wordmark"><span>Quest</span> <span>Night</span></h1><svg class="tower" viewBox="0 0 56 84" aria-hidden="true" focusable="false"><path d="M13 84V34h-3v-8h5v-4h4v4h4v-4h4v4h4v-4h4v4h4v8h-3v50z" fill="#1D1D68"/><path d="M19 84V58a6 6 0 0 1 12 0v26z" fill="#0B0B3A"/><rect x="21.5" y="38" width="4" height="9" rx="2" fill="#F6D98A"/><rect x="24.8" y="2" width="2.2" height="22" rx="1" fill="#B7A66C"/><path class="pennant" d="M27 3c8 3 13-3 22 1.5L44.5 11 49 18c-9-4-14 2-22-1z" fill="#E0AE52"/></svg></div>
      <p class="lede">Pick a party for each quest, vote it through, and find out who sabotaged it. For 5–10 players. Play on phones, with real cards, or both.</p>
      <div class="home-art" aria-hidden="true">${seals}</div>
    </div>
    <div class="home-paths">
      <section class="path"><h2 class="path-title">Host a table</h2>
        <p class="muted">You’re the Host. Play too, or sit out. Everyone else joins with a 6-letter room code.</p>
        <label class="field"><span>Your name</span><input data-i="hostName" maxlength="20" autocomplete="nickname" enterkeyhint="go" value="${esc(S.ui.draft.hostName || store.get(`${KEY}.name`) || '')}"></label>
        <button type="button" class="btn big" data-a="host">Open Table</button>
        ${mine.map((c) => `<p class="resume-row" data-room="${esc(c)}"><a class="resume" href="#/play/${esc(c)}">Back to table <b class="code">${esc(c)}</b></a><button type="button" class="resume-x" data-a="forgetRoom" data-v="${esc(c)}" aria-label="Forget table ${esc(c)} on this phone">${ui('x')}</button></p>`).join('')}</section>
      <section class="path"><h2 class="path-title">Join a table</h2>
        <div class="join-row"><label class="field"><span>Room code</span><input class="code-input" data-i="joinCode" maxlength="6" autocapitalize="characters" autocomplete="off" spellcheck="false" enterkeyhint="go" placeholder="6 letters" value="${esc(S.ui.draft.joinCode || '')}"></label>
        <button type="button" class="btn" data-a="goJoin">Join Table</button></div></section>
      <a class="side-card" href="#/faq"><span><b>Rules &amp; FAQ</b><small>Roles, table sizes, and what to do when it gets weird.</small></span>${CHEV}</a>
      <section class="how-sec"><h2 class="block-title">How to play</h2>
        <ol class="how">
          <li><h3>Join</h3><p>Everyone joins with the 6-letter code. Each player gets a secret card: Loyal Servant or Minion of Mordred.</p></li>
          <li><h3>Choose</h3><p>The leader (the crown) picks a party. Everyone votes, and a strict majority sends it out.</p></li>
          <li><h3>Quest</h3><p>Party members play Success or Sabotage face down. One Sabotage fails the quest, or two on quest 4 with 7+ players.</p></li>
          <li><h3>Win</h3><p>Three successful quests win for the Loyal Servants, unless the Assassin names Merlin. Three failed quests, or five rejected parties in a row, win for the Minions.</p></li>
        </ol></section>
      <p class="home-faq"><a class="link tiny" href="/print.html" target="_blank" rel="noopener">Print the card sheet</a></p>
    </div>
    <section class="more-games" aria-labelledby="more-h"><h2 class="block-title" id="more-h">More from Game Night</h2>
      <div class="more-grid">${MORE_GAMES.map((g) => `<a class="more-card ${g.cls}" data-card href="${g.href}"><span class="more-logo" aria-hidden="true">${g.logo}</span><span class="more-text"><b>${g.name}</b><small>${g.blurb}</small></span></a>`).join('')}
        <a class="more-card more-hub" data-card href="${HUB}"><span class="more-logo" aria-hidden="true">${HUB_LOGO}</span><span class="more-text"><b>Game Library</b><small>Every game in one place.</small></span></a></div></section>
    ${siteFooter()}
  </main>`;
}

function rulesPage() {
  const rows = Object.keys(QUEST_SIZES).map((n) => `<tr><td>${n}</td><td>${n - EVIL_COUNT[n]} / ${EVIL_COUNT[n]}</td><td>${QUEST_SIZES[n].map((s, i) => (n >= 7 && i === 3 ? `${s}*` : s)).join(', ')}</td></tr>`).join('');
  const role = (id, extra) => `<li class="a-${ROLES[id].side}">${glyph(ROLES[id].icon)}<span><b>${ROLES[id].name}</b><small>${esc(extra)}, card ${ROLE_CARD[id]}</small></span></li>`;
  return `<main class="wrap game rules-page">
    <p class="linkrow"><a class="link" href="#/">${ui('back')} Home</a><a class="link" href="#/faq">Rules &amp; FAQ</a></p>
    <section class="stage"><h1 class="phase-title">How to play</h1>
      <p>Everyone gets a secret card. Most of you are <b class="t-good">the Loyal Servants</b>. A few are <b class="t-evil">the Minions of Mordred</b>, and they know each other.</p>
      <p>Each round a <b>leader</b> (the crown) picks a party for the quest. Everyone votes to approve or reject it, and the votes are shown together. A strict majority sends the party out; otherwise the crown passes left. <b>Five rejected parties in a row and the Minions of Mordred win.</b></p>
      <p>On a quest each member plays a card face down: Loyal must play <b>Success</b>, Evil may play <b>Sabotage</b>. One sabotage breaks the quest, except quest 4 at 7+ players, which needs two (marked *).</p>
      <p>Three successful quests and the Loyal Servants of Arthur win, unless Merlin is in play: then the Assassin gets one last strike, and naming Merlin steals the game.</p>
      <p><b>The Lantern</b> (optional): after quests 2, 3 and 4 its holder secretly learns one player’s side, and the Lantern passes to them. Nobody who has held it can be looked at.</p>
    </section>
    <section class="stage"><h2 class="block-title">Table sizes</h2>
      <table class="sizes"><thead><tr><th>Players</th><th>Loyal / Evil</th><th>Quest Parties</th></tr></thead><tbody>${rows}</tbody></table></section>
    <section class="stage"><h2 class="block-title">Cards</h2><ul class="roles-list">
      ${role('servant', 'No special knowledge')}${role('merlin', 'Sees Evil (not Mordred)')}${role('percival', 'Sees Merlin and Morgana, not which is which')}
      ${role('minion', 'Knows Evil')}${role('assassin', 'Last strike at Merlin')}${role('morgana', 'Looks like Merlin to Percival')}
      ${role('mordred', 'Hidden from Merlin')}${role('oberon', 'Evil, but alone and unknown')}</ul>
      <p class="muted">Playing with a regular deck? <a href="/print.html" target="_blank" rel="noopener">Print the card guide</a>. It covers every table size, with the eyes-closed script.</p></section>
  </main>`;
}

function joinForm() {
  return `<main class="wrap join"><h1 class="phase-title">Join Table <span class="code">${esc(S.code)}</span></h1>
    <label class="field"><span>Your Name</span><input data-i="joinName" maxlength="20" autocomplete="nickname" enterkeyhint="go" value="${esc(S.ui.draft.joinName || store.get(`${KEY}.name`) || '')}"></label>
    <button type="button" class="btn big" data-a="join">Take a Seat</button>
    <p class="muted" style="margin-top:var(--s4)">If the game has started, you’ll watch unless the Host opens a seat for you. <a href="#/">Back</a></p></main>`;
}

// Phase badges use the icons drawn for Quest Night (art.js), not the stock set.
const PHASE = { lobby: ['Lobby', 'table'], reveal: ['Secret Cards', 'good'], propose: ['Choosing a Party', 'crown'], vote: ['Vote', 'approve'],
  quest: ['On the Quest', 'chalice'], lantern: ['The Lantern', 'lantern'], assassin: ['Last Strike', 'broken'], over: ['Game Over', 'chalice'] };
// The roles chip in every header: "8 roles", the same for every viewer. It opens the same sheet as the panel before the reveal.
const rolesChip = (v) => { const n = v.game?.n || v.players.filter((p) => !p.watch).length; return `<button type="button" class="roles-chip" data-a="roles" aria-label="Roles in this game${n >= MIN_PLAYERS ? `, ${n} roles` : ''}">${n >= MIN_PLAYERS ? `${n} roles` : 'Roles'}</button>`; };
function appbar(v) {
  const [label, icon] = PHASE[v.phase] || ['', 'crown'];
  return `<header class="appbar"><a class="appbar-mark" href="#/" aria-label="Home">${art('crown')}</a>
    <div class="appbar-title"><span class="appbar-word">Table</span> <span class="code">${esc(v.code)}</span></div>
    ${T.timerChip(v)}${rolesChip(v)}<span class="phase-badge">${art(icon)}<span class="pb-t">${label}</span></span></header>`;
}

const nameOf = (v, id) => v.players.find((p) => p.id === id)?.name || '?';
const names = (v, ids) => ids.map((id) => esc(nameOf(v, id))).join(', ');

// Phone: one pane at a time with a tab bar. Wide screens: log | table | chat-tools-host side by side.
function layout(v) {
  const tab = S.ui.tab;
  const main = v.phase === 'lobby' ? lobby(v) : v.phase === 'reveal' && !rolesSeen(v) ? rolesPanel(v) : gameMain(v);
  const sideTabs = [['chat', 'Chat'], ['tools', 'Tools'], ...(v.me?.host ? [['host', 'Host']] : [])];
  const sideKey = ['chat', 'tools', 'host'].includes(tab) ? tab : S.ui.side;
  const side = sideKey === 'tools' ? T.toolsPane(v) : sideKey === 'host' ? hostPane(v) : T.chatPane(v);
  return `<div class="layout" data-tab="${tab}">
    <main class="col col-main wrap game" data-pane="game">${v.paused ? `<p class="note is-warn">${ui('pause')} The Host paused the game.</p>` : ''}${main}</main>
    <aside class="col col-log" data-pane="log">${T.logPane(v, v.game ? chronicle(v) : '')}</aside>
    <aside class="col col-side" data-pane="side"><div class="seg side-seg" role="tablist">${sideTabs.map(([k, l]) => `<button type="button" role="tab" data-a="side" data-v="${k}" aria-selected="${sideKey === k}">${l}</button>`).join('')}</div>${side}</aside>
  </div>${T.tabbar(v)}`;
}

function gameMain(v) {
  if (v.me?.watch && !v.me.host) return [track(v), roundTable(v), `<section class="stage"><p class="say">You are watching this game. You’ll see what the whole table sees.</p></section>`, lastReveals(v)].join('');
  // At the deal, a player with a card to read sees it first, so the phone opens to the face-down card (Nishant 2026-10-28).
  // Every player with a card gets the same order, so the layout says nothing about the card.
  const cardFirst = v.phase === 'reveal' && v.game?.appRoles && !!v.me?.role && !v.game.ready.includes(v.me.id);
  return (cardFirst ? [stage(v), track(v), roundTable(v), lastReveals(v), myCardBlock(v)] : [track(v), roundTable(v), stage(v), lastReveals(v), myCardBlock(v)]).join('');
}

// ---------------------------------------------------------------- lobby (the setup part of the Host dashboard)
const MODES = [['phone', 'Phones Mode', 'Every player uses their own phone. Your role and cards stay hidden until you hold to reveal. Works online too.'],
  ['hybrid', 'Hybrid', 'Mix real cards and phones. Choose each piece below.'],
  ['physical', 'Host-Only Mode', 'Real cards on the table. This phone is the board and tracker.']];
const PIECE_TEXT = { roles: ['Secret Cards', 'role'], votes: ['Approve / Reject Votes', 'vote'], cards: ['Success / Sabotage Cards', 'quest card'] };
const HOUSE = [
  ['lantern', 'The Lantern', 'Official optional rule. After quests 2, 3, and 4, the holder learns one player’s side. Best at 7+.'],
  ['anonVotes', 'Anonymous Votes', 'Show only the count of approves and rejects, not who voted how.'],
  ['noClaims', 'No-Claims Mode', 'Turns off posting claims in the chat. Claims are made out loud.'],
  ['sitOut', 'Host sits out', 'The Host doesn’t get a card and sees the whole deal on their own phone.'],
];
function lobbyPlain(v) {
  const me = v.me; const seatedP = v.players.filter((p) => !p.watch); const n = seatedP.length; const host = me.host;
  const link = `${location.origin}/#/play/${v.code}`;
  const list = roleList(Math.max(5, Math.min(10, n)), v.settings);
  const status = n < MIN_PLAYERS ? `<p class="note is-warn">${ui('info')} ${MIN_PLAYERS - n} more to start (5–10 players).</p>`
    : list.error ? `<p class="note is-warn">${ui('warning')} ${esc(list.error)}</p>`
      : `<p class="note">${ui('check')} ${n - EVIL_COUNT[n]} Loyal and ${EVIL_COUNT[n]} Evil. Parties of ${QUEST_SIZES[n].join(', ')}${n >= 7 ? ' (quest 4 needs two sabotage cards)' : ''}.</p>`;
  const balance = n >= 5 && !list.error ? balanceTips(n, v.settings) : '';
  const seats = v.players.map((p, i) => `<li><span class="n">${p.watch ? '–' : i + 1}</span><span class="dot ${p.online || p.phoneless ? 'on' : ''}" title="${p.phoneless ? 'No phone' : p.online ? 'Connected' : 'Not connected'}"></span>
      <span class="who">${esc(p.name)}${p.host ? ' <small class="muted">Host</small>' : ''}${p.watch ? ' <small class="muted">watching</small>' : ''}${p.phoneless ? ' <small class="muted">no phone</small>' : ''}${p.id === me.id ? ' <small class="muted">you</small>' : ''}</span>
      ${host ? `<button class="icon-btn" data-a="move" data-id="${p.id}" data-dir="up" aria-label="Move ${esc(p.name)} up" ${i === 0 ? 'disabled' : ''}>${ui('caret-down', 'flip-up')}</button>
      <button class="icon-btn" data-a="move" data-id="${p.id}" data-dir="down" aria-label="Move ${esc(p.name)} down" ${i === v.players.length - 1 ? 'disabled' : ''}>${ui('caret-down')}</button>
      ${p.host ? '' : `<button class="icon-btn" data-a="kick" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">${ui('x')}</button>`}` : ''}</li>`).join('');
  const opts = steppersHtml(n, v.settings, host);
  const m = v.mode;
  const modes = MODES.map(([k, t, d]) => `<label class="toggle radio ${m.play === k ? 'is-on' : ''}"><input type="radio" name="play" data-a="modeSet" data-k="play" value="${k}" ${m.play === k ? 'checked' : ''} ${host ? '' : 'disabled'}><span><b>${t}</b><span class="muted">${d}</span></span></label>`).join('');
  const pieces = m.play === 'hybrid' ? `<div class="pieces">${Object.entries(PIECE_TEXT).map(([k, [t]]) => `<div class="piece"><span>${t}</span><span class="seg mini">${['app', 'physical'].map((x) => `<button type="button" data-a="piece" data-k="${k}" data-v="${x}" aria-pressed="${m[k] === x}" ${host ? '' : 'disabled'}>${x === 'app' ? 'In the app' : 'Physical'}</button>`).join('')}</span></div>`).join('')}</div>` : '';
  const house = HOUSE.map(([k, t, d]) => `<label class="toggle ${v.house[k] ? 'is-on' : ''}"><input type="checkbox" data-a="houseSet" data-k="${k}" ${v.house[k] ? 'checked' : ''} ${host ? '' : 'disabled'}><span><b>${t}</b><span class="muted">${d}</span></span></label>`).join('');
  const sel = (k, opts2) => `<select data-a="houseSel" data-k="${k}" ${host ? '' : 'disabled'}>${opts2.map(([val, l]) => `<option value="${val}" ${String(v.house[k]) === String(val) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const guide = m.roles === 'physical' && n >= 5 && !list.error ? cardGuideBlock(n, v.settings, v.house) : '';
  return `<section class="join-code"><p class="muted">Room code</p><p class="room-code">${esc(v.code)}</p>
      <p class="muted join-link">${esc(link)}</p>
      ${host ? `<button type="button" class="qr-tap" data-a="qrFull" data-link="${esc(link)}" data-code="${esc(v.code)}" aria-label="Show the join QR code full screen">${qrSvg(link, `QR code to join room ${v.code}`)}<span>Tap for Full Screen</span></button>` : ''}
      <div class="btn-row"><button class="btn ghost" data-a="copy" data-link="${esc(link)}">${ui('copy')} Copy Link</button>
      ${navigator.share ? `<button class="btn ghost" data-a="share" data-link="${esc(link)}">Share</button>` : ''}</div></section>
    <section class="stage"><h2 class="block-title">At the Table (${n})</h2>
      <p class="muted">Seat order is the order the crown travels. ${host ? 'Match it to how everyone is sitting.' : ''}</p>
      <ul class="seat-list">${seats}</ul>${status}${balance}
      ${host ? `<div class="add-seat"><label class="field"><span>Add a Seat Without a Phone</span><input data-i="seatName" maxlength="20" placeholder="Name" enterkeyhint="done" value="${esc(S.ui.draft.seatName || '')}"></label><button class="btn ghost" data-a="addSeat">Add Seat</button></div>
      <div class="btn-row"><button class="btn ghost" data-a="shuffleSeats">${ui('shuffle')} Shuffle Seats</button></div>` : ''}</section>
    <section class="stage"><h2 class="block-title">How You’re Playing</h2><div class="settings">${modes}</div>${pieces}
      ${m.play !== 'phone' ? `<p class="muted">Real cards: <a href="/print.html" target="_blank" rel="noopener">print the card guide or the Quest Night cards</a>. The Host enters anything physical and never sees a secret.</p>` : ''}</section>
    <section class="stage"><h2 class="block-title">Special Cards</h2>${host ? '' : '<p class="muted">The Host picks these.</p>'}
      ${opts}</section>
    <section class="stage"><h2 class="block-title">House Rules</h2><p class="muted">All off unless the Host turns them on. Otherwise the rules are the classic game.</p>
      <div class="settings">${house}
      <label class="toggle"><span><b>Phase Timer</b><span class="muted">A countdown starts each phase. Nothing happens at zero. The Host decides.</span></span>${sel('turnTimer', [[0, 'Off'], [60, '1 min'], [90, '1:30'], [120, '2 min'], [180, '3 min'], [300, '5 min']])}</label>
      <label class="toggle"><span><b>Vote Reveal Delay</b><span class="muted">A short drumroll before votes are shown.</span></span>${sel('revealDelay', [[0, 'Off'], [3, '3 s'], [5, '5 s']])}</label>
      <label class="toggle"><span><b>First Leader</b><span class="muted">Who wears the crown first.</span></span>${sel('firstLeader', [['random', 'Random'], ['host', 'The Host']])}</label></div></section>
    ${guide}
    ${host ? `<div class="sticky-act"><button class="btn big ${n < 5 || list.error ? 'disabled' : ''}" data-a="start">${m.roles === 'app' ? 'Deal Cards' : 'Start Game'}</button></div>`
    : '<div class="empty">Waiting for the Host to start…</div>'}`;
}

// ---------------------------------------------------------------- setup carousel (host): Players, Preset, Seating, Deal
const houseCount = (v) => HOUSE.filter(([k]) => v.house[k]).length;
const TIMER_TEXT = { 0: 'no phase timer', 60: 'phase timer 1 min', 90: 'phase timer 1:30', 120: 'phase timer 2 min', 180: 'phase timer 3 min', 300: 'phase timer 5 min' };
const setupFor = (v) => { if (!S.setup || S.setup.code !== v.code) S.setup = loadSetup({ getItem: (k) => store.get(k) }, v.code); return S.setup; };
const setupCtx = (v) => {
  const setup = setupFor(v);
  const n = v.players.filter((p) => !p.watch).length;
  const st = setupState(v, S.saved, setup);
  const seating = setup.seatingChosen && setup.seating ? setup.seating : defaultSeating(v.players);
  return { v, esc, ui, glyph, st, n, step: setup.step, seating, advanced: setup.advancedOpen, draft: S.ui.draft, link: `${location.origin}/#/play/${v.code}`, dir: S.ui.slide || '',
    advancedHtml: advancedBlock(v, n), advSummary: !v.house.turnTimer && !houseCount(v) ? 'Classic rules, no timer' : `${TIMER_TEXT[v.house.turnTimer] || 'no phase timer'}, ${houseCount(v)} house ${houseCount(v) === 1 ? 'rule' : 'rules'} on`,
    saved: S.saved, savedList: S.saved.map(savedPreset), pickedId: st.preset?.id || null, steppers: steppersHtml(n, v.settings, true) };
};
function lobby(v) {
  if (!v.me.host) return lobbyPlain(v);
  const c = setupCtx(v);
  if (S.page === 'presets') return presetsPage(c);
  if (S.page === 'customize') return customizePage(c);
  return carousel(c);
}
// Everything the old setup screen had that the carousel does not show by default: seat order, hybrid pieces, house rules, timers, card guide.
function advancedBlock(v, n) {
  const m = v.mode;
  const list = roleList(Math.max(5, Math.min(10, n)), v.settings);
  const seats = v.players.map((p, i) => `<li><span class="n">${p.watch ? '–' : i + 1}</span><span class="who">${esc(p.name)}${p.host ? ' <small class="muted">Host</small>' : ''}${p.phoneless ? ' <small class="muted">no phone</small>' : ''}</span>
      <button type="button" class="icon-btn" data-a="move" data-id="${p.id}" data-dir="up" aria-label="Move ${esc(p.name)} up" ${i === 0 ? 'disabled' : ''}>${ui('caret-down', 'flip-up')}</button>
      <button type="button" class="icon-btn" data-a="move" data-id="${p.id}" data-dir="down" aria-label="Move ${esc(p.name)} down" ${i === v.players.length - 1 ? 'disabled' : ''}>${ui('caret-down')}</button></li>`).join('');
  const pieces = m.play === 'hybrid' ? `<div class="pieces">${Object.entries(PIECE_TEXT).map(([k, [t]]) => `<div class="piece"><span>${t}</span><span class="seg mini">${['app', 'physical'].map((x) => `<button type="button" data-a="piece" data-k="${k}" data-v="${x}" aria-pressed="${m[k] === x}">${x === 'app' ? 'In the app' : 'Physical'}</button>`).join('')}</span></div>`).join('')}</div>` : '';
  const house = HOUSE.map(([k, t, d]) => `<label class="toggle ${v.house[k] ? 'is-on' : ''}"><input type="checkbox" data-a="houseSet" data-k="${k}" ${v.house[k] ? 'checked' : ''}><span><b>${t}</b><span class="muted">${d}</span></span></label>`).join('');
  const sel = (k, o) => `<select data-a="houseSel" data-k="${k}">${o.map(([val, l]) => `<option value="${val}" ${String(v.house[k]) === String(val) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const guide = m.roles === 'physical' && n >= 5 && !list.error ? cardGuideBlock(n, v.settings, v.house) : '';
  return `<h3 class="cs-adv-h">House rules</h3><p class="muted">All off unless you turn them on. Otherwise the rules are the classic game. These are pinned for this room when you deal.</p>
    <div class="settings">${house}
    <label class="toggle"><span><b>Phase Timer</b><span class="muted">A countdown starts each phase. Nothing happens at zero. The Host decides.</span></span>${sel('turnTimer', [[0, 'Off'], [60, '1 min'], [90, '1:30'], [120, '2 min'], [180, '3 min'], [300, '5 min']])}</label>
    <label class="toggle"><span><b>Vote Reveal Delay</b><span class="muted">A short drumroll before votes are shown.</span></span>${sel('revealDelay', [[0, 'Off'], [3, '3 s'], [5, '5 s']])}</label>
    <label class="toggle"><span><b>First Leader</b><span class="muted">Who wears the crown first.</span></span>${sel('firstLeader', [['random', 'Random'], ['host', 'The Host']])}</label></div>
    ${pieces ? `<h3 class="cs-adv-h">Real cards or the app</h3>${pieces}` : ''}
    ${m.play !== 'phone' ? '<p class="muted">Real cards: <a href="/print.html" target="_blank" rel="noopener">print the card guide or the Quest Night cards</a>. The Host enters anything physical and never sees a secret.</p>' : ''}
    <h3 class="cs-adv-h">Seat order</h3><p class="muted">Seat order is the order the crown travels. Match it to how everyone is sitting.</p>
    <ul class="seat-list">${seats}</ul><div class="btn-row"><button type="button" class="btn ghost" data-a="shuffleSeats">${ui('shuffle')} Shuffle Seats</button></div>${guide}`;
}

// ---- carousel actions
const stepName = (i) => SETUP_STEPS[i];
const announce = (t) => { const el = document.getElementById('step-live'); if (el) el.textContent = t; };
function goStep(i, dir) {
  const v = S.view; if (!v) return;
  const setup = setupFor(v); const from = setup.step; const to = clampStep(i);
  const st = setupState(v, S.saved, setup);
  // Forward past a problem snaps back to the first step that needs fixing, and says why.
  let target = to;
  if (to > from) { const b = firstBlocked(st, to); if (b >= 0) { target = b; toast(st.problems[b].text); } }
  setup.step = target; S.page = 'carousel';
  S.ui.slide = target === from ? '' : (dir || (target > from ? 'fwd' : 'back')); S.ui.focusHead = true;
  persistSetup(); announce(`Step ${target + 1} of ${SETUP_STEPS.length}, ${stepName(target)}`); render();
}
function afterSetupPaint() {
  const card = $app.querySelector('#cs-card');
  const slide = S.ui.slide; S.ui.slide = '';
  if (card && slide && card.animate) {
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches || !fx.enabled();
    const a = calm ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: `translateX(${slide === 'fwd' ? '100%' : '-100%'})` }, { transform: 'none' }];
    try { card.animate(a, { duration: dur(calm ? FADE_MS : SLIDE_MS), easing: 'cubic-bezier(.2,.8,.2,1)' }); } catch { /* never blocks */ }
  }
  if (S.ui.focusHead) { S.ui.focusHead = false; $app.querySelector('#cs-h')?.focus({ preventScroll: true }); }
  if (S.ui.focusId) { const f = document.getElementById(S.ui.focusId); S.ui.focusId = null; f?.focus(); }
}
function useSetupSettings(settings) { send({ type: 'settings', settings: { merlin: !!settings.merlin, percival: !!settings.percival, morgana: !!settings.morgana, mordred: !!settings.mordred, oberon: !!settings.oberon } }); }
function previewPreset(id) {
  const v = S.view; if (!v) return;
  const p = findPreset(id, S.saved); if (!p) return;
  const n = v.players.filter((x) => !x.watch).length;
  const ok = !!p.mix(n);
  const pick = () => { useSetupSettings(presetSettings(p)); setupFor(v).presetId = p.id; goStep(1, 'back'); };
  openSheet({ title: p.name, cls: 'preset-sheet', bodyHtml: previewBody(p, n, { esc, glyph }),
    buttons: ok ? [{ label: 'Use this', onClick: pick }, { label: 'Customize from here', cls: 'link', onClick: () => { useSetupSettings(presetSettings(p)); setupFor(v).presetId = p.id; persistSetup(); S.page = 'customize'; render(); } }]
      : [{ label: 'Add players', onClick: () => goStep(0, 'back') }, { label: 'Pick another', cls: 'ghost' }] });
}
function savedMenu(id) {
  const p = S.saved.find((x) => x.id === id); if (!p) return;
  let nameEl = null; // the sheet closes before onClick runs, so keep the input itself
  const dlg = openSheet({ title: p.name, cls: 'saved-sheet',
    bodyHtml: `<label class="field"><span>Name</span><input id="sv-name" maxlength="24" value="${esc(p.name)}"></label>`,
    buttons: [{ label: 'Save name', onClick: () => { const nm = (nameEl?.value || '').trim().slice(0, 24); if (nm) { p.name = nm; persistSaved(); render(); } } },
      { label: 'Delete', cls: 'ghost danger', close: false, onClick: () => { const b = document.querySelector('.saved-sheet .danger'); if (b?.dataset.sure) { S.saved = S.saved.filter((x) => x.id !== id); persistSaved(); dlg.close(); render(); } else if (b) { b.dataset.sure = '1'; b.textContent = 'Tap again to delete'; } } }] });
  nameEl = document.getElementById('sv-name');
}
function savePresetNow() {
  const v = S.view; if (!v) return;
  const st = setupState(v, S.saved, setupFor(v));
  if (st.list.error) { toast(st.list.error); return; }
  const name = (S.ui.draft.presetName || '').trim().slice(0, 24) || `My setup ${S.saved.length + 1}`;
  const item = { id: `s${Date.now().toString(36)}`, name, settings: { merlin: !!v.settings.merlin, percival: !!v.settings.percival, morgana: !!v.settings.morgana, mordred: !!v.settings.mordred, oberon: !!v.settings.oberon } };
  S.saved = [...S.saved, item].slice(-SAVED_PRESETS_MAX); persistSaved();
  setupFor(v).presetId = item.id; persistSetup(); S.ui.draft.presetName = '';
  toast('Saved on this phone.'); goStep(1, 'back');
}
function dealNow() {
  const v = S.view; const setup = setupFor(v);
  const st = setupState(v, S.saved, setup);
  if (st.problems[3]) { toast(st.problems[3].text); return; }
  const seating = setup.seatingChosen && setup.seating ? setup.seating : defaultSeating(v.players);
  const mm = modeFor(seating, v.mode, v.players);
  if (mm) send({ type: 'mode', mode: mm });
  send({ type: 'start' });
}
// Swipe is extra: Back, Next and the step dots always work.
{
  let sx = 0, sy = 0, down = false;
  $app.addEventListener('pointerdown', (e) => { down = !!e.target.closest('.cs-view') && !e.target.closest('input,select,textarea,summary,.cs-adv-body'); sx = e.clientX; sy = e.clientY; });
  $app.addEventListener('pointerup', (e) => {
    if (!down) return; down = false;
    const dx = e.clientX - sx; const dy = e.clientY - sy;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dy) > Math.abs(dx) / 1.5 || !S.view || S.page !== 'carousel') return;
    const cur = setupFor(S.view).step;
    goStep(cur + (dx < 0 ? 1 : -1), dx < 0 ? 'fwd' : 'back');
  });
  $app.addEventListener('toggle', (e) => { if (e.target.matches?.('[data-adv]') && S.setup) { S.setup.advancedOpen = e.target.open; persistSetup(); } }, true);
  $app.addEventListener('keydown', (e) => { // arrow keys move between steps while a step dot has focus
    if (!e.target.classList?.contains('cs-dot') || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault(); goStep(setupFor(S.view).step + (e.key === 'ArrowRight' ? 1 : -1));
  });
}

// ---- the roles panel before the reveal (same for every phone) and its "seen" memory
const seenKey = (v) => `${v.code}:${v.gameNo || 1}`;
const rolesSeen = (v) => store.get(`${KEY}.rolesSeen`) === seenKey(v);
function rolesPanel(v) {
  const info = rolesInGame(rolesSeats(v), v.settings);
  return rolesPanelHtml(info, esc, glyph, rolesButtonLabel(v));
}

function steppersHtml(n, settings, host) {
  const m = setupSteppers(n, settings, host);
  const why = (r) => r.plus.disabled && host && r.value < r.max;
  const last = {}; for (const r of m.rows) if (why(r)) last[r.plus.reason] = r.key; // each reason shown once, under the last row it applies to
  const row = (r) => `<div class="step-row a-${r.side}"><span class="rs-ico">${glyph(r.icon)}</span><span class="step-text"><b>${r.label}</b><small>${esc(r.blurb)}</small></span>
      <span class="step-ctl"><button type="button" class="icon-btn" data-a="step" data-k="${r.key}" data-d="-1" aria-label="Remove ${esc(r.label)}" ${r.minus.disabled ? 'disabled' : ''}>${ui('minus')}</button><b aria-live="polite">${r.value}</b>
      <button type="button" class="icon-btn" data-a="step" data-k="${r.key}" data-d="1" aria-label="Add ${esc(r.label)}" ${r.plus.disabled ? 'disabled' : ''}>${ui('plus')}</button></span></div>${why(r) && last[r.plus.reason] === r.key ? `<p class="step-why" role="note">${esc(r.plus.reason)}</p>` : ''}`;
  const fill = (f) => `<div class="step-row is-fill a-${f.side}"><span class="rs-ico">${glyph(f.icon)}</span><span class="step-text"><b>${esc(f.label)}</b><small>Fills the rest</small></span>
      <span class="step-ctl"><button type="button" class="icon-btn" disabled aria-label="${esc(f.label)}: ${esc(f.reason)}">${ui('minus')}</button><b>${f.count}</b><button type="button" class="icon-btn" disabled aria-label="${esc(f.label)}: ${esc(f.reason)}">${ui('plus')}</button></span></div>`;
  return `<div class="steppers">${m.rows.map(row).join('')}${m.fills.map(fill).join('')}</div>${m.error ? `<p class="note is-warn" role="alert">${ui('warning')} ${esc(m.error)}</p>` : ''}`;
}

function balanceTips(n, s) {
  const tips = [];
  if (!s.merlin) tips.push('Without Merlin the Loyal Servants have no information: Evil usually does well.');
  if (s.percival && !s.morgana) tips.push('Percival without Morgana finds Merlin for sure, which helps the Loyal Servants a lot.');
  if (s.morgana && !s.percival) tips.push('Morgana only matters if Percival is in play.');
  if (n <= 6 && (s.mordred || s.oberon)) tips.push('Mordred and Oberon are strong at small tables.');
  if (n >= 7 && s.merlin && !s.percival) tips.push('At 7+ the classic setup adds Percival and Morgana.');
  return tips.length ? `<ul class="tips">${tips.map((t) => `<li>${ui('info')} ${esc(t)}</li>`).join('')}</ul>` : '';
}

function cardGuideBlock(n, settings, house) {
  const rc = roleCards(n, settings);
  if (rc.error) return '';
  return `<section class="stage"><h2 class="block-title">Card Setup for ${n}</h2>
    <p class="muted">Shuffle these ${n} cards and deal one face down to each player. Red is Loyal, black is Evil.</p>
    <ul class="card-key">${rc.cards.map((c) => `<li class="a-${ROLES[c.role].side}"><b class="pc ${/[♥♦]/.test(c.card) ? 'is-red' : ''}">${c.card}</b> ${esc(ROLES[c.role].name)}</li>`).join('')}</ul>
    <ul class="tips">${[CARD_PIECES.approve, CARD_PIECES.reject, CARD_PIECES.success, CARD_PIECES.sabotage, CARD_PIECES.crown, ...(house.lantern ? [CARD_PIECES.lantern, CARD_PIECES.loyalty] : [])].map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>`;
}

// ---------------------------------------------------------------- game pieces
function track(v) {
  const g = v.game;
  const seals = g.sizes.map((s, i) => {
    const r = g.results[i];
    const cls = r === 'success' ? 'is-success' : r === 'fail' ? 'is-fail' : i === g.quest && v.phase !== 'over' && v.phase !== 'assassin' ? 'is-now' : '';
    const pop = S.ui.fresh.quest && i === g.results.length - 1 ? ' is-pop' : '';
    const inner = r === 'success' ? art('chalice') : r === 'fail' ? art('broken') : `<b>${s}</b>`;
    return `<div class="seal ${cls}${pop}" aria-label="Quest ${i + 1}: ${r || `${s} servants`}">${inner}${g.needs[i] === 2 ? '<span class="two-fail" title="Needs two sabotage cards to fail">2</span>' : ''}<small>Quest ${i + 1}</small></div>`;
  }).join('');
  const pips = Array.from({ length: g.maxRejects }, (_, i) => `<i class="${i < g.rejects ? 'on' : ''} ${i === g.maxRejects - 1 ? 'last' : ''}"></i>`).join('');
  return `<section class="track" aria-label="Quests"><div class="seals">${seals}</div>
    <div class="seals-legend"><span><b data-roll="ok">${g.results.filter((r) => r === 'success').length}</b> succeeded, <b data-roll="bad">${g.results.filter((r) => r === 'fail').length}</b> failed</span>
    <span class="rejects" title="Rejected parties this quest">Rejected ${pips}</span></div></section>`;
}

function marksFor(v) {
  const g = v.game; const m = {};
  // what you know about others is private: it shows on the table only while your card is revealed
  if (S.ui.showCard) for (const k of v.me?.sees || []) m[k.id] = k.tag === 'evil' ? ['is-evil', art('evil'), 'Known Evil'] : ['is-merlin', glyph('merlin'), 'Merlin or Morgana'];
  if (S.ui.showCard) for (const k of v.me?.lanternSeen || []) m[k.id] = k.side === 'evil' ? ['is-evil', art('evil'), 'Lantern: Evil'] : ['is-good', art('good'), 'Lantern: Loyal'];
  if (v.moderator) for (const [id, r] of Object.entries(v.moderator.roles)) m[id] = [r.side === 'evil' ? 'is-evil' : 'is-good', glyph(r.icon), r.name];
  if (v.phase === 'vote') for (const id of g.voted) m[id] = ['is-done', ui('check'), 'Has voted'];
  if (v.phase === 'quest') for (const id of g.played) m[id] = ['is-done', ui('check'), 'Has played'];
  if (v.phase === 'reveal') for (const id of g.ready) m[id] = ['is-done', ui('check'), 'Ready'];
  if (v.phase === 'assassin' && g.evil) { for (const id of g.evil) m[id] = ['is-evil', art('evil'), 'Evil']; m[g.assassin] = ['is-evil', glyph('assassin'), 'Assassin']; }
  if (v.phase === 'over' && g.roles) for (const [id, r] of Object.entries(g.roles)) m[id] = [r.side === 'evil' ? 'is-evil' : 'is-good', glyph(r.icon), r.name];
  return m;
}

function lanternMark(g) {
  const key = `lantern:${g.lantern.checks}`; const a = fx.on(key);
  return `<span class="servant-lantern ${a >= 0 ? 'is-glow' : ''}" title="Holds the Lantern"${fx.st(key)}>${a >= 0 ? '<i class="lantern-glow"></i>' : ''}${art('lantern')}</span>`;
}

function roundTable(v) {
  const g = v.game; const seats = v.players.filter((p) => !p.watch); const n = seats.length;
  const meIdx = Math.max(0, seats.findIndex((p) => p.id === v.me?.id));
  const marks = marksFor(v);
  const host = v.me?.host;
  const leadP = seats.find((p) => p.id === g.leader);
  const picking = v.phase === 'propose' && (g.leader === v.me?.id || (host && (leadP?.phoneless || v.mode.play === 'physical')));
  const striking = v.phase === 'assassin' && g.appRoles && g.assassin === v.me?.id;
  const hostStrike = v.phase === 'assassin' && !g.appRoles && host;
  const holderP = g.lantern && seats.find((p) => p.id === g.lantern.holder);
  const lanterning = v.phase === 'lantern' && g.lantern && (g.lantern.holder === v.me?.id || (host && (!g.appRoles || holderP?.phoneless)));
  const forLeader = picking && g.leader !== v.me?.id; // the Host enters a party for a leader without a phone, or at a physical table
  const team = forLeader ? S.ui.team : g.team;
  const chosen = v.phase === 'lantern' ? S.ui.lantern : v.phase === 'assassin' ? S.ui.strike : null;
  const tallying = v.phase === 'vote' && v.mode.votes === 'physical' && host;
  const seatEls = seats.map((p, i) => {
    const ang = Math.PI / 2 + ((i - meIdx) * 2 * Math.PI) / n;
    const x = 50 + 41 * Math.cos(ang); const y = 50 + 41 * Math.sin(ang);
    const onTeam = team.includes(p.id) || chosen === p.id;
    const canLantern = lanterning && p.id !== g.lantern.holder && !g.lantern.held.includes(p.id);
    const canPick = picking || (striking && !g.evil?.includes(p.id)) || hostStrike || canLantern || tallying;
    const act = picking ? (forLeader ? 'pickLocal' : 'pick') : striking ? 'strike' : hostStrike ? 'hostStrike' : canLantern ? 'examine' : tallying ? 'tallyToggle' : '';
    const yes = tallying && S.ui.tally[p.id];
    const mk = tallying ? (yes ? ['is-good', art('approve'), 'Approved'] : ['is-evil', art('reject'), 'Rejected']) : marks[p.id];
    const tag = canPick ? 'button' : 'div';
    const label = `${p.name}${g.leader === p.id ? ', leader' : ''}${onTeam ? (chosen ? ', chosen' : ', on the party') : ''}${mk ? `, ${mk[2]}` : ''}`;
    return `<${tag} class="servant ${p.id === v.me?.id ? 'is-me' : ''} ${onTeam ? 'on-team' : ''} ${canPick ? 'can-pick' : ''} ${p.online || p.phoneless ? '' : 'is-off'}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%"
      ${canPick ? `type="button" data-a="${act}" data-id="${p.id}" aria-pressed="${onTeam || !!yes}"` : ''} aria-label="${esc(label)}">
      <span class="servant-disc">${initial(p.name)}${g.leader === p.id && v.phase !== 'over' ? `<span class="servant-crown">${art('crown')}</span>` : ''}${g.lantern?.holder === p.id && v.phase !== 'over' ? lanternMark(g) : ''}${mk ? `<span class="servant-mark ${mk[0]}" title="${esc(mk[2])}">${mk[1]}</span>` : ''}</span>
      <span class="servant-name">${esc(p.name)}</span></${tag}>`;
  }).join('');
  let felt = '';
  const size = g.sizes[g.quest];
  if (v.phase === 'propose') felt = `<b>${esc(nameOf(v, g.leader))}</b> wears the crown.<br>Party of ${size}: ${team.length} chosen`;
  else if (v.phase === 'vote') felt = v.mode.votes === 'app' ? `<b data-roll="voted">${g.voted.length}</b> of ${n} have voted` : 'Votes at the table';
  else if (v.phase === 'quest') felt = v.mode.cards === 'app' ? `${g.played.length} of ${g.team.length} cards played` : 'Quest cards at the table';
  else if (v.phase === 'reveal') felt = g.appRoles ? `${g.ready.length} of ${n} have read their card` : 'Look at your card';
  else if (v.phase === 'lantern') felt = `<b>${esc(nameOf(v, g.lantern.holder))}</b> raises the Lantern`;
  else if (v.phase === 'assassin') felt = 'Evil stands revealed.';
  else if (v.phase === 'over') felt = g.winner === 'good' ? 'Arthur’s side holds.' : 'Mordred’s side wins.';
  return `<section class="round" aria-label="The table"><div class="round-felt">${art('table')}<p>${felt}</p></div>${seatEls}</section>`;
}

// The big button at the bottom of the phone, with the Host's skip chip: hostNav says what it reads and does.
function dock(v) {
  const nav = hostNav(v, S.ui); if (!nav) return '';
  return `<div class="sticky-act dock"><button type="button" class="btn big ${nav.disabled ? 'disabled' : ''}" data-a="dockGo" ${nav.disabled ? 'disabled aria-disabled="true"' : ''}>${esc(nav.label)}</button>${nav.skip ? `<button type="button" class="btn ghost chip" data-a="dockSkip">${esc(nav.skip.label)}</button>` : ''}</div>`;
}

function stage(v) {
  const D = dock(v);
  const g = v.game; const me = v.me; const size = g.sizes[g.quest];
  const role = me.role; const host = me.host;
  const say = (t) => `<p class="say">${t}</p>`;
  if (v.phase === 'reveal') {
    if (!g.appRoles || !role) return `<section class="stage"><h1 class="phase-title">Secret Cards</h1>${say(g.appRoles ? 'The players are reading their cards.' : 'Everyone looks at their own card. The Host reads the eyes-closed script from the Host tab.')}
      ${D}</section>`;
    const ready = g.ready.includes(me.id);
    return `<section class="stage reveal-stage"><h1 class="phase-title">Your Secret Card</h1>
      ${say('Shield your screen. Hold the card to see it, then let go.')}
      ${cardView(v, true)}
      ${ready ? '<p class="muted center">Waiting for the others to read their cards…</p>' : '<button class="btn big" data-a="ready">I’m Ready</button>'}
      ${D}</section>`;
  }
  if (v.phase === 'propose') {
    const leadP = v.players.find((p) => p.id === g.leader);
    const forLeader = host && g.leader !== me.id && (leadP?.phoneless || v.mode.play === 'physical');
    if (g.leader !== me.id && !forLeader) return `<section class="stage"><h1 class="phase-title">${esc(nameOf(v, g.leader))} Is Choosing</h1>
      ${say(`A party of ${size} for quest ${g.quest + 1}. Argue your case out loud.`)}${g.rejects === g.maxRejects - 1 ? hammer() : ''}${D}</section>`;
    return `<section class="stage"><h1 class="phase-title">${forLeader ? `Enter ${esc(nameOf(v, g.leader))}’s Party` : 'You Wear the Crown'}</h1>
      ${say(forLeader ? `Tap the ${size} players ${esc(nameOf(v, g.leader))} names for quest ${g.quest + 1}.` : `Tap ${size} servants at the table for quest ${g.quest + 1}. You can choose yourself.`)}
      ${g.rejects === g.maxRejects - 1 ? hammer() : ''}
      ${D}</section>`;
  }
  if (v.phase === 'vote') {
    const head = `<h1 class="phase-title">Send This Party?</h1>${say(`${names(v, g.team)} for quest ${g.quest + 1}, chosen by ${esc(nameOf(v, g.leader))}.`)}${g.rejects === g.maxRejects - 1 ? hammer() : ''}`;
    if (v.mode.votes === 'physical') {
      if (!host) return `<section class="stage">${head}<p class="note">${ui('hand')} Vote with your cards at the table. On three, everyone turns theirs over.</p></section>`;
      return `<section class="stage">${head}<p class="note">${ui('hand')} <span>Tap everyone who showed <b>Approve</b> on the table above, then confirm.</span></p>${D}</section>`;
    }
    if (me.watch) return `<section class="stage">${head}${D}</section>`;
    const voted = 'vote' in me;
    return `<section class="stage">${head}${D}
      ${voted ? `<p class="note">${ui('check')} You voted ${me.vote ? 'approve' : 'reject'}. Votes are shown when everyone is in.</p>`
    : `<div class="choice-pair"><button class="choice yes" data-a="vote" data-v="1">${art('approve')}Approve</button><button class="choice no" data-a="vote" data-v="0">${art('reject')}Reject</button></div>`}</section>`;
  }
  if (v.phase === 'quest') {
    if (v.mode.cards === 'physical') {
      const head = `<h1 class="phase-title">The Party Rides Out</h1>${say(`${names(v, g.team)}: each take one Success and one Sabotage card, play one face down. The leader shuffles them and turns them over.`)}`;
      if (!host) return `<section class="stage">${head}</section>`;
      return `<section class="stage">${head}<p class="note">How many Sabotage cards were turned up?${g.needs[g.quest] === 2 ? ' This quest needs two to fail.' : ''}</p>
        <div class="btn-row wrap big-nums">${Array.from({ length: g.team.length + 1 }, (_, i) => `<button class="btn ${S.ui.fails === i ? '' : 'ghost'}" data-a="questResult" data-v="${i}" aria-pressed="${S.ui.fails === i}">${i}</button>`).join('')}</div>${D}</section>`;
    }
    const onIt = g.team.includes(me.id);
    if (!onIt) return `<section class="stage"><h1 class="phase-title">The Party Rides Out</h1>${say(`${names(v, g.team)} are choosing their cards in secret.`)}${D}</section>`;
    if (me.played) return `<section class="stage"><h1 class="phase-title">Card Played</h1>${say('Face down and shuffled in. Waiting for the rest of the party.')}${D}</section>`;
    // Every player gets the same words and the same two buttons, so a glance at your phone shows nothing about your side.
    return `<section class="stage"><h1 class="phase-title">Play Your Card</h1>
      ${say(`Choose in secret. Loyal Servants can only play Success.${g.needs[g.quest] === 2 ? ' This quest needs two Sabotage cards to fail.' : ''}`)}
      <div class="choice-pair"><button class="choice success" data-a="play" data-v="0">${art('chalice')}Success</button>
      <button class="choice sabotage" data-a="play" data-v="1">${art('broken')}Sabotage</button></div>${D}</section>`;
  }
  if (v.phase === 'lantern') {
    const L = g.lantern; const holder = L.holder === me.id;
    if (holder && g.appRoles) return `<section class="stage"><h1 class="phase-title">Raise the Lantern</h1>${say('Tap one player who has not held the Lantern. You alone learn their side, then the Lantern passes to them. You may tell the table anything, true or not.')}${D}</section>`;
    if (host && (!g.appRoles || v.players.find((p) => p.id === L.holder)?.phoneless)) return `<section class="stage"><h1 class="phase-title">The Lantern</h1>${say(`${esc(nameOf(v, L.holder))} chooses someone who hasn’t held it. That player passes ${esc(nameOf(v, L.holder))} their loyalty card face down. Tap who was chosen.`)}${D}</section>`;
    return `<section class="stage"><h1 class="phase-title">The Lantern</h1>${say(`${esc(nameOf(v, L.holder))} will look into one player’s heart.`)}${D}</section>`;
  }
  if (v.phase === 'assassin') {
    if (!g.appRoles) return `<section class="stage"><h1 class="phase-title">The Assassin Takes Aim</h1>${say('Evil, show your cards. The Assassin names one servant.')}${host ? `<p class="note">Tap who the Assassin named, then say if they were Merlin.</p>${S.ui.strike ? `<div class="choice-pair"><button class="choice no" data-a="strikeHit" data-v="1" aria-pressed="${S.ui.hit === true}">It Was Merlin</button><button class="choice yes" data-a="strikeHit" data-v="0" aria-pressed="${S.ui.hit === false}">Not Merlin</button></div>` : ''}${D}` : ''}</section>`;
    if (g.assassin === me.id) return `<section class="stage"><h1 class="phase-title">Name Merlin</h1>${say('Three quests succeeded. Talk it over with Evil, then tap the one you believe is Merlin. You get one strike.')}${D}</section>`;
    return `<section class="stage"><h1 class="phase-title">The Assassin Takes Aim</h1>${say(`${g.assassin ? esc(nameOf(v, g.assassin)) : 'The Assassin'} will name one servant. If it is Merlin, the Minions of Mordred win.`)}${D}</section>`;
  }
  if (v.phase === 'over') return over(v);
  return '';
}
const hammer = () => `<p class="note is-out">${ui('warning')} Fifth party this quest. If it is rejected, the Minions of Mordred win.</p>`;

function over(v) {
  const g = v.game; const me = v.me;
  const side = g.winner;
  const why = { rejects: 'Five parties were turned away in a row.', quests: side === 'good' ? 'Three quests succeeded.' : 'Three quests were sabotaged.',
    assassin: `The Assassin named ${esc(nameOf(v, g.target))}, Merlin.`, survived: `The Assassin named ${esc(nameOf(v, g.target))}, who was not Merlin.`, unstruck: 'The Assassin made no strike.' }[g.reason];
  const won = me?.role ? (me.role.side === side ? '<p><b>You won.</b></p>' : '<p><b>You lost.</b></p>') : '';
  const roles = g.roles ? v.players.filter((p) => g.roles[p.id]).map((p) => { const r = g.roles[p.id]; return `<li class="a-${r.side}">${glyph(r.icon)}<span><b>${esc(p.name)}</b><small>${esc(r.name)}</small></span></li>`; }).join('') : '';
  return `<section class="winner a-${side}">${art(side === 'good' ? 'chalice' : 'evil')}<h1>${side === 'good' ? 'The Loyal Servants of Arthur win' : 'The Minions of Mordred win'}</h1>
      <p class="say">${why}</p>${won}</section>
    ${roles ? `<section class="stage"><h2 class="block-title">Who Was Who</h2><ul class="roles-list">${roles}</ul></section>` : '<section class="stage"><p class="say">Everyone, turn your cards over.</p></section>'}
    ${me?.host ? '<div class="sticky-act"><button class="btn big" data-a="restart">Restart</button><button class="btn ghost" data-a="again">Change setup first</button></div>' : v.kind === 'screen' ? '' : '<p class="muted center">The Host can start another game.</p>'}`;
}

// A deterministic cosmetic shuffle (so a re-render keeps the same order): the table sees how many sabotage cards
// there were, never who played them.
const shuffled = (arr, seed) => { const a = arr.slice(); let x = seed * 2654435761 + 12345; for (let i = a.length - 1; i > 0; i--) { x = (x * 1664525 + 1013904223) >>> 0; const j = x % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function lastReveals(v) {
  const g = v.game; const out = [];
  if (g.lastQuest && ['propose', 'lantern', 'assassin', 'over'].includes(v.phase) && g.lastQuest.quest === g.quest - 1 && !(g.lastVote && g.lastVote.quest === g.quest)) {
    const q = g.lastQuest; const key = `quest:${q.quest}`;
    if (S.ui.fresh.quest) fx.cue(key, () => {
      const n = q.size; const step = Math.min(25, Math.floor(100 / Math.max(1, n - 1)));
      setTimeout(() => (q.result === 'success' ? fx.burstAt('[data-fx="quest"]', 'gold', 18) : (fx.stamp('Sabotaged'), fx.burstAt('[data-fx="quest"]', 'red', 12))), dur(150 + (n - 1) * step));
    });
    const a = fx.on(key);
    const cards = shuffled(Array.from({ length: q.size }, (_, i) => (i < q.size - q.fails ? 's' : 'f')), q.quest + 1);
    const step = Math.min(25, Math.floor(100 / Math.max(1, q.size - 1)));
    out.push(`<section class="reveal ${S.ui.fresh.quest ? 'is-new' : ''}"><h2 class="reveal-h ${q.result === 'success' ? 'ok' : 'bad'}" data-fx="quest">Quest ${q.quest + 1} ${q.result === 'success' ? 'succeeded' : 'failed'}</h2>
      <div class="flips qcards ${a >= 0 ? 'fx-q' : ''}" style="--n:${q.size};--step:${step}ms${a >= 0 ? `;--age:${a}ms` : ''}">${cards.map((c, i) => `<span class="flip ${c} ${a >= 0 ? 'fx-a' : ''}" style="--i:${i};--sg:${i % 2 ? -1 : 1}">${art(c === 's' ? 'chalice' : 'broken')}</span>`).join('')}</div>
      <p class="muted center"><b data-roll="fails">${q.fails}</b> sabotage card${q.fails === 1 ? '' : 's'}${q.need === 2 ? ' (two were needed)' : ''}.</p></section>`);
  }
  const lv = g.lastVote;
  if (lv && (v.phase === 'quest' || (v.phase === 'propose' && lv.quest === g.quest) || (v.phase === 'over' && g.reason === 'rejects'))) {
    const delay = v.house.revealDelay && S.ui.fresh.vote ? v.house.revealDelay : 0;
    if (delay) { S.ui.holdVote = Date.now() + delay * 1000; setTimeout(render, delay * 1000 + 30); }
    if (S.ui.holdVote && Date.now() < S.ui.holdVote) out.push(`<section class="reveal"><h2 class="reveal-h">The votes are in…</h2><p class="say center">Revealing in a moment.</p></section>`);
    else {
      const key = `vote:${g.history.length}`;
      // animate once per vote: the render that shows it first (right away, or when the reveal delay ends)
      const first = !!(S.ui.fresh.vote || (S.ui.holdVote && S.ui.heldKey !== key)); if (first) S.ui.heldKey = key;
      if (first) fx.cue(key, () => fx.burstAt('[data-fx="vote"]', lv.passed ? 'gold' : 'red', 12));
      const a = fx.on(key);
      out.push(`<section class="reveal ${first ? 'is-new' : ''}"><h2 class="reveal-h ${lv.passed ? 'ok' : 'bad'}">Party ${lv.passed ? 'approved' : 'rejected'} ${lv.yes}–${lv.no}</h2>
      <div class="vtiles" data-fx="vote"><div class="vtile yes ${a >= 0 ? 'fx-a' : ''}"${fx.st(key)}><span class="vt-face"><b data-roll="vy">${lv.yes}</b><small>Approve</small></span><span class="vt-back"></span></div>
      <div class="vtile no ${a >= 0 ? 'fx-a' : ''}"${fx.st(key)}><span class="vt-face"><b data-roll="vn">${lv.no}</b><small>Reject</small></span><span class="vt-back"></span></div></div>
      <p class="muted">${names(v, lv.team)}, chosen by ${esc(nameOf(v, lv.leader))}.</p>
      ${v.house.anonVotes ? '<p class="muted">Anonymous votes: only the count is shown.</p>' : `<div class="vote-cols"><div class="yes"><h4>Approve</h4><ul>${lv.approve.map((id) => `<li>${esc(nameOf(v, id))}</li>`).join('') || '<li>nobody</li>'}</ul></div>
      <div class="no"><h4>Reject</h4><ul>${lv.reject.map((id) => `<li>${esc(nameOf(v, id))}</li>`).join('') || '<li>nobody</li>'}</ul></div></div>`}</section>`);
    }
    if (S.ui.holdVote && Date.now() >= S.ui.holdVote) S.ui.holdVote = 0;
  }
  return out.join('');
}

// Private info (your card, who you see) is blurred until you hold the card (or tap it for a few seconds).
// While hidden, the markup is the same for every role: same size, same words, same timing.
const GHOST_ROWS = 3;
function cardView(v) {
  const r = v.me.role; const shown = S.ui.showCard;
  const unveil = shown && S.ui.unveil && fx.enabled(); S.ui.unveil = false; // the fade-in plays for the press that showed the card, never for re-renders while it is held
  const sees = (v.me.sees || []).map((k) => `<li class="${k.tag === 'evil' ? 'is-evil' : 'is-merlin'}">${k.tag === 'evil' ? art('evil') : glyph('merlin')}<span><b>${esc(nameOf(v, k.id))}</b> ${k.tag === 'evil' ? 'serves Evil' : 'is Merlin or Morgana'}</span></li>`).join('');
  const lan = (v.me.lanternSeen || []).map((k) => `<li class="${k.side === 'evil' ? 'is-evil' : 'is-good'}">${art('lantern')}<span>Lantern: <b>${esc(nameOf(v, k.id))}</b> is ${k.side === 'evil' ? 'of Evil' : 'Loyal'}</span></li>`).join('');
  const hint = { merlin: 'Mordred, if dealt, is hidden from you.', percival: 'One of these is Merlin. The other may be Morgana.', oberon: 'You know none of Evil.' }[r.id] || '';
  const face = shown
    ? `<div class="cardart a-${r.side}">${art(r.side, 'crest')}${glyph(r.icon, 'big')}</div>
        <div class="rcard-body"><h2 class="rcard-name">${esc(r.name)}</h2><span class="side-tag a-${r.side}">${esc(r.sideName)}</span><p class="rcard-blurb">${esc(r.blurb)}</p></div>`
    : `<div class="cardart a-hidden">${art('crown')}</div>
        <div class="rcard-body"><h2 class="rcard-name">Your Role</h2><span class="side-tag a-hidden">Hidden</span><p class="rcard-blurb">Only you can see this card. Hold it to look.</p></div>`;
  const card = `<button type="button" class="rcard-tap" data-tilt data-a="flip" aria-pressed="${shown}" aria-label="${shown ? 'Your card is showing. Release to hide it.' : 'Hold to reveal your card'}">
    <div class="rcard ${shown ? `is-shown${unveil ? ' is-unveil' : ''} a-${r.side}` : 'is-hidden a-hidden'}" data-face="front"><div class="rcard-inner">
      <div class="rcard-face rcard-front">${face}</div>${shown ? '' : '<span class="reveal-cue">Hold to Reveal</span>'}</div></div></button>`;
  const ghost = Array.from({ length: GHOST_ROWS }, () => `<li class="is-ghost" aria-hidden="true">${art('evil')}<span><b>Player name</b> hidden</span></li>`).join('');
  const rows = sees + lan;
  const box = shown
    ? `<ul class="sees">${rows || '<li class="is-none"><span>You see nobody.</span></li>'}</ul>${hint ? `<p class="muted">${hint}</p>` : ''}`
    : `<ul class="sees is-blur">${ghost}</ul><p class="muted">Who you see stays hidden too.</p>`;
  return `<div class="hand">${card}<div class="sees-box" aria-live="polite">${box}</div><p class="muted reveal-hint">${shown ? 'Release to hide.' : 'Hold, or tap for a few seconds.'}</p></div>`;
}

function myCardBlock(v) {
  if (v.phase === 'reveal' || v.phase === 'over' || !v.me?.role) return '';
  return `<section class="stage"><h2 class="block-title">Your Card</h2>${cardView(v)}</section>`;
}

function chronicle(v) {
  const g = v.game;
  if (!g.history.length) return '';
  const items = [...g.history].reverse().map((h) => `<li class="${h.passed ? 'ok' : 'bad'}">Quest ${h.quest + 1}, party ${h.attempt}: <b>${esc(nameOf(v, h.leader))}</b> chose ${names(v, h.team)}. ${h.passed ? 'Approved' : 'Rejected'} ${h.yes}–${h.no}${h.reject.length ? ` (against: ${names(v, h.reject)})` : ''}.${h.passed && g.results[h.quest] ? ` Quest ${g.results[h.quest] === 'success' ? 'succeeded' : `failed with ${g.questFails[h.quest]} sabotage`}.` : ''}</li>`).join('');
  return `<h3 class="sub">The Chronicle</h3><ul class="history">${items}</ul>`;
}

// ---------------------------------------------------------------- Host script (read aloud)
function openingScript(roleSet, lantern) {
  const has = (r) => roleSet.includes(r);
  const L = ['Everyone, close your eyes and put your hand in a fist on the table.'];
  L.push(`Evil${has('oberon') ? ', except Oberon,' : ''} open your eyes and look around. These are your allies.`, '(Pause.) Evil, close your eyes.');
  if (has('merlin')) L.push(`Evil${has('mordred') ? ', except Mordred,' : ''} raise your thumb.`, 'Merlin, open your eyes. These players serve Evil.', '(Pause.) Merlin, close your eyes. Evil, lower your thumbs.');
  if (has('percival')) L.push(`Merlin${has('morgana') ? ' and Morgana' : ''}, raise your thumb.`, `Percival, open your eyes. ${has('morgana') ? 'One of these is Merlin.' : 'This is Merlin.'}`, '(Pause.) Percival, close your eyes. Thumbs down.');
  L.push('Everyone, open your eyes.');
  if (lantern) L.push('The player to the right of the first leader takes the Lantern.');
  return L;
}
function phaseScript(v) {
  const g = v.game; if (!g) return [];
  const lead = nameOf(v, g.leader); const size = g.sizes[g.quest];
  switch (v.phase) {
    case 'reveal': return openingScript(g.roleSet, !!g.lantern);
    case 'propose': return [`${lead} wears the crown.`, `${lead}, choose ${size} servants for quest ${g.quest + 1}.${g.needs[g.quest] === 2 ? ' This quest needs two sabotage cards to fail.' : ''}`, ...(g.rejects === g.maxRejects - 1 ? ['This is the fifth party. If it is rejected, the Minions of Mordred win.'] : [])];
    case 'vote': return ['Everyone, choose approve or reject.', v.mode.votes === 'physical' ? 'On three, turn your vote card over. One, two, three.' : 'Vote on your phones. The votes appear together.'];
    case 'quest': return [`${names(v, g.team)}, you ride out.`, v.mode.cards === 'physical' ? 'Each of you, play one card face down and hand back the other. Leader, shuffle them and turn them over one at a time.' : 'Play your card on your phone.'];
    case 'lantern': return [`${nameOf(v, g.lantern.holder)}, raise the Lantern.`, 'Choose one player who has not held it.', v.game.appRoles ? 'Their side appears on your phone only.' : 'They pass you their loyalty card face down. Look, and hand it back.', 'The Lantern now passes to them.'];
    case 'assassin': return ['Three quests have succeeded.', 'Evil, reveal yourselves.', 'Assassin, talk with your allies, then name the one you believe is Merlin.'];
    case 'over': return ['The game is over. Everyone, turn your cards over.'];
    default: return [];
  }
}
const scriptHtml = (lines) => `<ol class="narration">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>`;

function hostControls(v) {
  const g = v.game; if (!g || v.phase === 'over') return '';
  const seats = v.players.filter((p) => !p.watch);
  let idle = [];
  if (v.phase === 'reveal') idle = seats.filter((p) => !g.ready.includes(p.id) && !p.phoneless);
  if (v.phase === 'vote' && v.mode.votes === 'app') idle = seats.filter((p) => !g.voted.includes(p.id));
  if (v.phase === 'quest' && v.mode.cards === 'app') idle = seats.filter((p) => g.team.includes(p.id) && !g.played.includes(p.id));
  const skipText = { reveal: 'Mark Ready', vote: 'Skip (Reject)', quest: 'Skip (Success)' }[v.phase];
  return `<h3 class="sub">This Phase</h3>
    ${idle.length ? `<ul class="dash-list">${idle.map((p) => `<li><span class="who">${esc(p.name)} <small class="muted">waiting</small></span><span class="btn-row"><button class="btn ghost sm" data-a="nudge" data-id="${p.id}">Nudge</button><button class="btn ghost sm" data-a="skip" data-id="${p.id}">${skipText}</button></span></li>`).join('')}</ul>` : ''}
    <div class="btn-row wrap">${v.phase === 'reveal' ? '<button class="btn ghost" data-a="skipReveal">Start First Party</button>' : ''}
    ${v.phase === 'propose' ? '<button class="btn ghost" data-a="skip">Pass the Crown</button>' : ''}${v.phase === 'lantern' ? '<button class="btn ghost" data-a="skip">Skip the Lantern</button>' : ''}</div>
    <p class="muted">Skips and undos are written in the log for everyone.</p>
    ${v.moderator ? `<h3 class="sub">The Deal (Host Only)</h3><ul class="roles-list">${seats.map((p) => { const r = v.moderator.roles[p.id]; return r ? `<li class="a-${r.side}">${glyph(r.icon)}<span><b>${esc(p.name)}</b><small>${esc(r.name)}</small></span></li>` : ''; }).join('')}</ul>` : ''}`;
}

function hostPane(v) {
  const g = v.game;
  const script = g ? `${scriptHtml(phaseScript(v))}<details class="faq-q"><summary>Opening Script (Eyes Closed)</summary>${scriptHtml(openingScript(g.roleSet, !!g.lantern))}</details>`
    : `<p class="muted">Once you start, the lines to read aloud for each phase appear here.</p>`;
  const toggle = `<label class="toggle fx-opt ${fx.isUserOn() ? 'is-on' : ''}"><input type="checkbox" data-a="fxSet" ${fx.isUserOn() ? 'checked' : ''}><span><b>Animations</b><span class="muted">Reveals, bursts, scroll effects, and the victory card on this device. Always off if your device asks for reduced motion.</span></span></label>`;
  const tools = `<div class="btn-row wrap"><button type="button" class="btn ghost" data-a="roles">Roles in this game</button>${v.phase !== 'lobby' ? '<button type="button" class="btn ghost" data-a="restartAsk">Restart game…</button>' : ''}</div>`;
  return T.hostPane(v, toggle + tools + hostControls(v), script);
}

// ---------------------------------------------------------------- shared table screen (TV / laptop)
function tableScreen(v) {
  const g = v.game;
  const head = `<header class="appbar"><span class="appbar-mark">${art('crown')}</span><div class="appbar-title">Quest Night <span class="code">${esc(v.code)}</span></div>${T.timerChip(v)}${rolesChip(v)}<span class="phase-badge">${art(PHASE[v.phase]?.[1] || 'crown')}<span class="pb-t">${PHASE[v.phase]?.[0] || ''}</span></span></header>`;
  if (!g) return `${head}<main class="wrap screen-lobby"><h1 class="phase-title">Join at ${esc(location.host)}</h1><p class="room-code">${esc(v.code)}</p><p class="say">${v.players.filter((p) => !p.watch).map((p) => esc(p.name)).join(' · ') || 'Nobody yet.'}</p></main>`;
  const lines = phaseScript(v).slice(0, 2);
  return `${head}<div class="layout is-screen"><main class="col col-main wrap game">${track(v)}${roundTable({ ...v, me: null })}${v.phase === 'over' ? over(v) : `<section class="stage"><p class="say">${esc(lines.join(' '))}</p></section>`}${lastReveals(v)}</main>
    <aside class="col col-log">${T.logPane(v, chronicle(v))}</aside><aside class="col col-side">${T.chatPane(v, true)}</aside></div>`;
}

// ---------------------------------------------------------------- transport
function wsTransport(code, asScreen) {
  let ws; let closed = false; let tries = 0; let timer; let longTimer;
  const creds = () => { try { return JSON.parse(store.get(`${KEY}.player.${code}`) || 'null'); } catch { return null; } };
  const open = () => {
    // Each socket's handlers check s === ws, so a socket abandoned by a wake-up reconnect can't schedule another one.
    const s = ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${code}`);
    ws.onopen = () => { if (s !== ws) return s.close(); tries = 0; S.conn = true; S.connLong = false; clearTimeout(longTimer); longTimer = null; const c = creds();
      if (asScreen) ws.send(JSON.stringify({ type: 'hello', screen: true }));
      else if (c) ws.send(JSON.stringify({ type: 'hello', ...c }));
      else if (S.pendingJoin) { ws.send(JSON.stringify({ type: 'hello', join: S.pendingJoin, hostKey: store.get(`${KEY}.host.${code}`) || undefined })); S.pendingJoin = null; }
      render(); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'view') onView(m.view);
      else if (m.type === 'gameover') onGameOver(m);
      else if (m.type === 'error') toast(m.error);
      else if (m.type === 'joined') store.set(`${KEY}.player.${code}`, JSON.stringify({ playerId: m.playerId, token: m.token }));
      else if (m.type === 'closed') { closed = true; store.del(`${KEY}.player.${code}`); store.del(`${KEY}.host.${code}`); S.ended = true; S.view = null; render(); }
      else if (m.type === 'fatal') { if (m.clear) { store.del(`${KEY}.player.${code}`); S.view = null; toast(m.error); render(); } else { closed = true; S.fatal = /expired/i.test(m.error) ? FATAL.gone : FATAL.closed; render(); } }
    };
    ws.onclose = () => { if (closed || s !== ws) return; S.conn = false; if (!longTimer) longTimer = setTimeout(() => { if (!S.conn && !closed) { S.connLong = true; render(); } }, 20000); render(); timer = setTimeout(open, Math.round(Math.min(8000, 400 * 2 ** tries++) * (0.75 + Math.random() * 0.5))); }; // +/-25% jitter so a room's phones don't all reconnect in lockstep
  };
  open();
  // Phone back (screen on, app switched back, signal back): reconnect now instead of waiting up to 8 s for the timer.
  const stopWake = wakeReconnect({ getSocket: () => ws, isStopped: () => closed, reconnect: () => { clearTimeout(timer); tries = 0; open(); } });
  return {
    send: (a) => { if (ws?.readyState === 1) ws.send(JSON.stringify(a)); else toast('Couldn’t reach the room yet. Try again in a moment.'); },
    close: () => { closed = true; stopWake(); clearTimeout(timer); clearTimeout(longTimer); ws?.close(); },
  };
}

// The server's game-over event: every client (players, the Host, the table screen) gets it at once.
function onGameOver(m) {
  const v = S.view; if (!v?.game) return;
  const g = v.game; const side = m.winner;
  const roles = g.roles ? v.players.filter((p) => g.roles[p.id]).map((p) => ({ name: p.name, role: g.roles[p.id].name, side: g.roles[p.id].side, icon: glyph(g.roles[p.id].icon) })) : [];
  fx.victory({ side, title: `${m.winnerName} win`, text: m.text, status: m.won === true ? 'You won!' : m.won === false ? 'You lost' : '', crest: art(side === 'good' ? 'good' : 'evil'),
    roles, onRestart: v.me?.host && v.kind !== 'screen' ? () => send({ type: 'restart' }) : null, onAgain: v.me?.host && v.kind !== 'screen' ? () => send({ type: 'again' }) : null, noFocus: v.kind === 'screen' });
}

// A restarted game (same code, new gameNo): drop everything tied to the old one. The stored player token still works.
function newGameReset() {
  closeSheets(); fx.closeVictory(); fx.resetMarks(); rv.hide();
  Object.assign(S.ui, { showCard: false, unveil: false, flip: false, fresh: {}, tab: 'game', draft: { ...S.ui.draft, chat: '' } });
  resetChoices();
}

function onView(v) {
  const p = S.view;
  if (p && v.code === p.code && (p.gameNo || 1) !== (v.gameNo || 1)) newGameReset();
  if (p?.game && v.game) {
    if (v.game.results.length > p.game.results.length) S.ui.fresh.quest = true;
    if (v.game.history.length > p.game.history.length) S.ui.fresh.vote = true;
  }
  if (v.phase !== p?.phase) { rv.hide(); S.ui.showCard = false; resetChoices(); }
  else if (p?.game && v.game && (v.game.leader !== p.game.leader || v.game.quest !== p.game.quest)) S.ui.team = [];
  if (p?.phase !== v.phase && navigator.vibrate && ['vote', 'quest', 'lantern', 'assassin', 'over'].includes(v.phase)) try { navigator.vibrate(30); } catch { /* ignore */ }
  if (v.phase !== 'over') fx.closeVictory();
  if (v.game?.lantern && v.phase === 'lantern' && p?.phase !== 'lantern') { fx.mark(`lantern:${v.game.lantern.checks}`); fx.glow(); }
  if ((v.me?.lanternSeen?.length || 0) > (p?.me?.lanternSeen?.length || 0)) fx.glow(); // the holder's own result, on their own phone
  T.onView(p, v);
  S.view = v; render();
}

// ---------------------------------------------------------------- routing
async function route() {
  S.transport?.close(); S.transport = null; S.view = null; fx.closeVictory(); S.fatal = null; S.ended = false; S.pruned = false; S.conn = true; S.connLong = false; rv.hide(); S.ui.showCard = false;
  const [kind, arg] = location.hash.replace(/^#\/?/, '').split('/');
  if ((kind === 'play' || kind === 'join' || kind === 'screen') && /^[A-Za-z]{6}$/.test(arg || '')) {
    S.mode = kind === 'screen' ? 'screen' : 'play'; S.code = arg.toUpperCase();
    const ex = await fetch(`/api/room/${S.code}`).then((r) => r.ok).catch(() => false);
    if (!ex) { store.del(`${KEY}.player.${S.code}`); S.fatal = FATAL.noRoom(S.code); }
    else {
      S.pendingJoin = sessionStorage.getItem(`${KEY}.pendingJoin`);
      sessionStorage.removeItem(`${KEY}.pendingJoin`);
      S.transport = wsTransport(S.code, S.mode === 'screen');
    }
  } else if (kind === 'rules') S.mode = 'rules';
  else if (kind === 'faq') S.mode = 'faq';
  else S.mode = 'home';
  render();
  if (S.mode === 'faq' || S.mode === 'rules') window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
const rawSend = (msg) => S.transport?.send(msg);

// ---------------------------------------------------------------- events
const rv = createReveal({ onChange: (on) => { S.ui.showCard = on; S.ui.unveil = on; render(); } });
// Pointer events on document: the card is re-rendered while it is held, so the release lands on a new element.
$app.addEventListener('pointerdown', (e) => { if (e.button > 0 || !e.target.closest('[data-a="flip"]')) return; e.preventDefault(); rv.press(); });
for (const t of ['pointerup', 'pointercancel']) document.addEventListener(t, () => rv.release());
$app.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-a="flip"]')) e.preventDefault(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) rv.hide(); });
window.addEventListener('blur', () => rv.hide());
wireFaqSearch($app);
$app.addEventListener('input', (e) => { const k = e.target.dataset.i; if (k) S.ui.draft[k] = e.target.value; });
$app.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const k = e.target.dataset.i;
  if (k === 'hostName') act('host'); else if (k === 'joinCode') act('goJoin'); else if (k === 'joinName') act('join');
  else if (k === 'chat') { e.preventDefault(); T.handle('chat'); } else if (k === 'seatName') act('addSeat');
});
$app.addEventListener('submit', (e) => e.preventDefault());
$app.addEventListener('change', (e) => {
  const el = e.target; const k = el.dataset.k;
  if (el.dataset.a === 'set') send({ type: 'settings', settings: { [k]: el.checked } });
  else if (el.dataset.a === 'houseSet') send({ type: 'house', house: { [k]: el.checked } });
  else if (el.dataset.a === 'houseSel') { send({ type: 'house', house: { [k]: el.value } }); el.blur(); }
  else if (el.dataset.a === 'modeSet') send({ type: 'mode', mode: { play: el.value } });
  else if (el.dataset.a === 'fxSet') { fx.setUserOn(el.checked); render(); }
});
$app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (el) fieldDown = false;
  if (!el || ['set', 'houseSet', 'houseSel', 'modeSet', 'fxSet'].includes(el.dataset.a)) return;
  if (el.getAttribute('aria-disabled') === 'true') { if (el.dataset.a === 'play') toast('The Loyal Servants can only play Success.'); return; }
  if (el.dataset.a === 'flip') { if (e.detail === 0) { rv.press(); rv.release(); } return; } // keyboard; touch and mouse use pointer events
  if (T.handle(el.dataset.a, el)) return;
  act(el.dataset.a, el);
});

// The join QR, full screen. It lives outside #app so the app's re-renders don't close it.
function showQr(link, code) {
  const o = document.createElement('div');
  o.className = 'qr-full'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-label', 'Join QR code');
  o.innerHTML = `<div class="qr-card">${qrSvg(link, `QR code to join room ${code}`)}<p class="room-code">${esc(code)}</p><p class="muted">Scan to join, or enter the room code.</p><button type="button" class="btn ghost">Close</button></div>`;
  const close = () => { document.removeEventListener('fullscreenchange', onFs); document.removeEventListener('keydown', onKey); if (document.fullscreenElement === o) document.exitFullscreen?.().catch(() => {}); o.remove(); };
  const onFs = () => { if (!document.fullscreenElement) close(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  o.addEventListener('click', close);
  document.body.append(o);
  o.querySelector('button').focus();
  if (canFullscreen(o)) { document.addEventListener('fullscreenchange', onFs); enterFullscreen(o); }
  document.addEventListener('keydown', onKey);
}

const rolesSeatsLobby = () => S.view.players.filter((p) => !p.watch).length;
function showRoles() {
  const v = S.view; if (!v) return;
  const info = rolesInGame(rolesSeats(v), v.settings);
  const seats = v.game ? 'The roles dealt this game' : 'The roles planned for this table';
  openSheet({ title: 'Roles in this game', cls: 'roles-sheet',
    bodyHtml: `<p class="muted">${seats}, ${info.seats} players. Who holds which is secret.</p>${rolesSheetBody(info, esc, glyph)}`,
    buttons: [{ label: 'Close', cls: 'ghost' }] });
}
function restartAsk() {
  openSheet({ title: 'Restart the game?', cls: 'restart-sheet',
    bodyHtml: '<p>Everyone stays seated and gets a fresh deal with the same setup. The chat, log and quests so far are cleared.</p>',
    buttons: [{ label: 'Keep playing', cls: 'ghost' }, { label: 'Change setup first', cls: 'ghost', onClick: () => send({ type: 'again' }) }, { label: 'Restart now', onClick: () => send({ type: 'restart' }) }] });
}

async function act(a, el) {
  const d = el?.dataset || {};
  switch (a) {
    case 'host': {
      const name = (S.ui.draft.hostName ?? store.get(`${KEY}.name`) ?? '').trim();
      if (!name) { toast('Type your name first.'); return; }
      store.set(`${KEY}.name`, name);
      const r = await fetch('/api/create', { method: 'POST' }).then((x) => x.json()).catch(() => ({ error: 'Could not reach the server.' }));
      if (r.error) { toast(r.error); return; }
      store.set(`${KEY}.host.${r.code}`, r.hostKey);
      sessionStorage.setItem(`${KEY}.pendingJoin`, name);
      location.hash = `#/play/${r.code}`;
      return;
    }
    case 'forgetRoom': store.del(`${KEY}.player.${d.v}`); store.del(`${KEY}.host.${d.v}`); el.closest('.resume-row')?.remove(); return;
    case 'goJoin': {
      const c = (S.ui.draft.joinCode || '').trim().toUpperCase();
      if (!/^[A-Z]{6}$/.test(c)) { toast('Room codes are 6 letters.'); return; }
      location.hash = `#/play/${c}`; return;
    }
    case 'join': {
      const name = (S.ui.draft.joinName ?? store.get(`${KEY}.name`) ?? '').trim();
      if (!name) { toast('Type your name first.'); return; }
      store.set(`${KEY}.name`, name);
      rawSend({ type: 'hello', join: name, hostKey: store.get(`${KEY}.host.${S.code}`) || undefined }); return;
    }
    case 'addSeat': { const n = (S.ui.draft.seatName || '').trim(); if (!n) { toast('Type a name for the seat.'); return; } send({ type: 'addSeat', name: n }); S.ui.draft.seatName = ''; document.activeElement?.blur?.(); return; }
    case 'copy': try { await navigator.clipboard.writeText(d.link); toast('Invite link copied.'); } catch { toast(d.link); } return;
    case 'share': try { await navigator.share({ title: 'Quest Night', text: 'Join my Quest Night table', url: d.link }); } catch { /* cancelled */ } return;
    case 'qrFull': showQr(d.link, d.code); return;
    case 'roles': showRoles(); return;
    case 'rolesSeen': store.set(`${KEY}.rolesSeen`, seenKey(S.view)); window.scrollTo(0, 0); render(); return;
    case 'csNext': { const st = setupState(S.view, S.saved, setupFor(S.view)); const p = st.problems[setupFor(S.view).step]; if (p) { toast(p.text); return; } goStep(setupFor(S.view).step + 1, 'fwd'); return; }
    case 'csBack': goStep(setupFor(S.view).step - 1, 'back'); return;
    case 'csGo': { const t = +d.s; if (t > setupFor(S.view).step) return; goStep(t, t > setupFor(S.view).step ? 'fwd' : 'back'); return; }
    case 'csDeal': dealNow(); return;
    case 'csFix': {
      if (d.go === 'presets') { S.page = 'presets'; S.ui.focusHead = true; render(); return; }
      goStep(+d.go, 'back'); if (d.focus) S.ui.focusId = `cs-${d.focus}`; return;
    }
    case 'seating': { const setup = setupFor(S.view); setup.seating = d.v; setup.seatingChosen = true; persistSetup(); const mm = modeFor(d.v, S.view.mode, S.view.players); if (mm) send({ type: 'mode', mode: mm }); render(); return; }
    case 'presetsOpen': S.page = 'presets'; S.ui.focusHead = true; render(); window.scrollTo(0, 0); return;
    case 'presetsBack': S.page = 'carousel'; S.ui.focusHead = true; render(); return;
    case 'presetPreview': previewPreset(d.id); return;
    case 'customize': S.page = 'customize'; S.ui.focusHead = true; render(); window.scrollTo(0, 0); return;
    case 'savedMenu': savedMenu(d.id); return;
    case 'savePreset': savePresetNow(); return;
    case 'step': { const msg = stepMessage(rolesSeatsLobby(), S.view.settings, d.k, +d.d, !!S.view.me?.host); if (msg) send(msg); else if (S.view.me?.host) toast('That change would make the setup invalid.'); return; }
    case 'restart': send({ type: 'restart' }); return;
    case 'restartAsk': restartAsk(); return;
    case 'start': if (el.classList.contains('disabled')) { toast('Not ready to start yet.'); return; } send({ type: 'start' }); return;
    case 'vote': haptic(15); send({ type: 'vote', approve: d.v === '1' }); return;
    case 'play':
      // Same buzz and same next screen for both buttons; a Loyal Servant's Sabotage counts as Success (the room enforces it too).
      haptic(15); send({ type: 'play', sabotage: d.v === '1' && S.view?.me?.role?.side !== 'good' }); return;
    case 'piece': send({ type: 'mode', mode: { play: 'hybrid', [d.k]: d.v } }); return;
    case 'tallyToggle': S.ui.tally[d.id] = !S.ui.tally[d.id]; render(); return;
    case 'questResult': S.ui.fails = +d.v; render(); return;
    case 'examine': S.ui.lantern = d.id; render(); return;
    case 'hostStrike': case 'strike': S.ui.strike = d.id; S.ui.hit = null; render(); return;
    case 'strikeHit': S.ui.hit = d.v === '1'; render(); return;
    case 'pickLocal': S.ui.team = S.ui.team.includes(d.id) ? S.ui.team.filter((x) => x !== d.id) : [...S.ui.team, d.id]; render(); return;
    case 'dockGo': { const nav = hostNav(S.view, S.ui); if (nav && !nav.disabled) { send(nav.send); resetChoices(); } return; }
    case 'dockSkip': { const nav = hostNav(S.view, S.ui); if (nav?.skip) { nav.skip.msgs.forEach(send); resetChoices(); } return; }
    case 'skip': send({ type: 'skip', id: d.id }); return;
    case 'pick': case 'move': case 'ready': case 'skipReveal': case 'again': case 'shuffleSeats':
      send({ type: a, id: d.id, dir: d.dir }); return;
    default:
  }
}

route();
