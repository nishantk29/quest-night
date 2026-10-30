// The table layer's screens, shared by Quest Night and Council Night (identical copy in each repo):
// tab bar, chat and claims, the game log, Table Tools, the Host dashboard frame, timers, wake lock, nudges.
// The game passes in its own pieces (script, physical-input controls, names); everything else is here.

const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const left = (t) => (t ? (t.endsAt ? t.endsAt - Date.now() : t.left ?? 0) : 0);
const rnd = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
const TIMER_PRESETS = [[30, '0:30'], [60, '1:00'], [120, '2:00'], [180, '3:00'], [300, '5:00']];
const KIND_LABEL = { chat: '', claim: 'Claim', tool: 'Tools', sys: '', host: 'Host', game: '' };

export function askConfirm(text, yesLabel = 'Yes') {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog'); dlg.className = 'confirm-sheet';
    const msg = document.createElement('p'); msg.textContent = text;
    const row = document.createElement('div'); row.className = 'btn-row';
    const no = document.createElement('button'); no.type = 'button'; no.className = 'btn ghost'; no.dataset.a = 'confirmNo'; no.textContent = 'Cancel';
    const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'btn'; yes.dataset.a = 'confirmYes'; yes.textContent = yesLabel;
    row.append(no, yes); dlg.append(msg, row); document.body.append(dlg);
    const done = (ok) => { dlg.close(); dlg.remove(); resolve(ok); };
    yes.onclick = () => done(true); no.onclick = () => done(false);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) done(false); });
    dlg.showModal(); yes.focus();
  });
}

export function makeTable(ctx) {
  const { S, send, esc, ui, toast } = ctx;
  S.ui.tab ||= 'game'; S.ui.side ||= 'chat'; S.ui.dice ||= { count: 1, sides: 6 }; S.ui.private ||= null;
  const nameOf = (v, id) => v.players.find((p) => p.id === id)?.name || '?';
  const isHost = (v) => !!v.me?.host;
  const seatedPlayers = (v) => v.players.filter((p) => !p.watch);

  // ------------------------------------------------------------ chrome
  function tabbar(v) {
    const unread = Math.max(0, (v.log.filter((m) => m.kind === 'chat' || m.kind === 'claim').at(-1)?.n || 0) - (S.ui.seenChat || 0));
    const tabs = [['game', 'table', 'Table'], ['chat', 'note', 'Chat'], ['log', 'log', 'Log'], ['tools', 'tools', 'Tools']];
    if (isHost(v)) tabs.push(['host', 'crown', 'Host']);
    return `<nav class="tabbar" aria-label="Sections">${tabs.map(([k, icon, label]) => `<button type="button" data-a="tab" data-v="${k}" aria-current="${S.ui.tab === k ? 'page' : 'false'}">${ui(icon)}<span>${label}</span>${k === 'chat' && unread && S.ui.tab !== 'chat' ? `<b class="badge">${unread > 9 ? '9+' : unread}</b>` : ''}</button>`).join('')}</nav>`;
  }

  function timerChip(v) {
    const out = [];
    if (v.paused) out.push(`<span class="chip is-paused">${ui('pause')} Paused</span>`);
    if (v.timer) out.push(`<span class="chip ${left(v.timer) <= 0 ? 'is-out' : ''}">${ui('timer')} ${esc(v.timer.label)} <b data-ends="${v.timer.endsAt || ''}" data-left="${v.timer.left ?? ''}">${mmss(left(v.timer))}</b></span>`);
    if (v.talk) out.push(`<span class="chip">${ui('ear')} ${esc(nameOf(v, v.talk.order[v.talk.i]))} <b data-ends="${v.talk.endsAt || ''}" data-left="${v.talk.left ?? ''}">${mmss(left(v.talk))}</b></span>`);
    return out.length ? `<div class="chips" role="status">${out.join('')}</div>` : '';
  }

  // ------------------------------------------------------------ chat + log
  const stamp = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  function entry(v, m, mod) {
    const lab = KIND_LABEL[m.kind];
    return `<li class="msg k-${m.kind} ${m.hidden ? 'is-hidden' : ''}">${m.by && (m.kind === 'chat' || m.kind === 'claim') ? `<b class="who">${esc(m.by)}</b>` : ''}${lab ? `<span class="tag">${lab}</span>` : ''}<span class="txt">${esc(m.text)}</span>
      <time>${stamp(m.t)}</time>${mod && !m.hidden && (m.kind === 'chat' || m.kind === 'claim') ? `<button class="link tiny" data-a="hideMsg" data-n="${m.n}" aria-label="Remove this message">Remove</button>` : ''}</li>`;
  }
  function chatPane(v, screen = false) {
    const msgs = v.log.filter((m) => m.kind === 'chat' || m.kind === 'claim' || m.kind === 'host');
    const can = v.me && !v.me.muted && !screen;
    const claims = !v.house.noClaims;
    return `<section class="pane-sec chat" aria-label="Table chat"><h2 class="block-title">Table chat</h2>
      <p class="muted">Everyone at the table sees this. There is no private channel: secrets stay secret.${claims ? ' Post a claim to put it on the record.' : ' No-claims mode: make claims out loud.'}</p>
      <ol class="msgs" data-scroll="chat">${msgs.map((m) => entry(v, m, isHost(v))).join('') || '<li class="muted">No messages yet.</li>'}</ol>
      ${can ? `<form class="chat-form" data-f="chat"><label class="sr-only" for="chat-in">Message</label><input id="chat-in" data-i="chat" maxlength="280" autocomplete="off" enterkeyhint="send" placeholder="${claims ? 'Say something or claim' : 'Say something'}" value="${esc(S.ui.draft.chat || '')}">
        <button type="button" class="btn" data-a="chat">Send</button>${claims ? '<button type="button" class="btn ghost" data-a="claim" title="Put it in the claims log">Claim</button>' : ''}</form>`
    : v.me?.muted ? '<p class="note is-warn">The Host muted you in the chat.</p>' : ''}
    </section>`;
  }
  function logPane(v, extra = '') {
    const filt = S.ui.logFilter || 'all';
    const list = v.log.filter((m) => (filt === 'all' ? m.kind !== 'chat' : filt === 'claims' ? m.kind === 'claim' : m.kind === filt)).slice().reverse();
    const seg = [['all', 'Everything'], ['game', 'Game'], ['claims', 'Claims'], ['tool', 'Tools']];
    return `<section class="pane-sec" aria-label="Game log"><h2 class="block-title">Game log</h2>
      <div class="seg" role="group" aria-label="Show">${seg.map(([k, l]) => `<button type="button" data-a="logFilter" data-v="${k}" aria-pressed="${filt === k}">${l}</button>`).join('')}</div>
      <ol class="msgs log">${list.map((m) => entry(v, m, false)).join('') || '<li class="muted">Nothing yet.</li>'}</ol>${extra}</section>`;
  }

  // ------------------------------------------------------------ tools
  function toolsPane(v) {
    const host = isHost(v); const d = S.ui.dice; const t = v.timer; const k = v.talk; const p = v.poll;
    const priv = S.ui.private;
    return `<section class="pane-sec" aria-label="Table Tools"><h2 class="block-title">Table Tools</h2>
      <p class="muted">Results go to everyone and into the log, drawn by the server so nobody can fudge them. Private rolls stay on this phone.</p>
      <div class="tool-grid">
        <button type="button" class="tool-btn" data-a="coin">${ui('coin')}<span>Flip a coin</span></button>
        <div class="tool-btn as-box">${ui('dice')}<span>Roll</span>
          <div class="dice-row"><button class="icon-btn" data-a="dCount" data-v="-1" aria-label="Fewer dice">${ui('minus')}</button><b>${d.count}</b><button class="icon-btn" data-a="dCount" data-v="1" aria-label="More dice">${ui('plus')}</button>
          <span class="seg mini">${[6, 20].map((s) => `<button type="button" data-a="dSides" data-v="${s}" aria-pressed="${d.sides === s}">d${s}</button>`).join('')}</span></div>
          <button type="button" class="btn" data-a="dice">Roll ${d.count}d${d.sides}</button></div>
        <button type="button" class="tool-btn" data-a="pickPlayer">${ui('pick')}<span>Pick a random player</span></button>
        <div class="tool-btn as-box">${ui('eye-off')}<span>Private (only you see)</span><div class="btn-row"><button class="btn ghost" data-a="privCoin">Coin</button><button class="btn ghost" data-a="privDice">${d.count}d${d.sides}</button></div>${priv ? `<p class="priv-out" role="status">${esc(priv)}</p>` : ''}</div>
      </div>
      ${host ? `<h3 class="sub">Timers</h3>
        ${t ? `<div class="timer-big ${left(t) <= 0 ? 'is-out' : ''}"><span>${esc(t.label)}</span><b data-ends="${t.endsAt || ''}" data-left="${t.left ?? ''}">${mmss(left(t))}</b><button class="btn ghost" data-a="timerStop">Stop</button></div>` : ''}
        <div class="btn-row wrap">${TIMER_PRESETS.map(([s, l]) => `<button class="btn ghost" data-a="timer" data-v="${s}">${l}</button>`).join('')}</div>
        <h3 class="sub">Talk turns</h3><p class="muted">Each player gets a turn to speak, around the table from the leader.</p>
        ${k ? `<div class="timer-big"><span>${esc(nameOf(v, k.order[k.i]))} (${k.i + 1} of ${k.order.length})</span><b data-ends="${k.endsAt || ''}" data-left="${k.left ?? ''}">${mmss(left(k))}</b><button class="btn" data-a="talkNext">Next</button><button class="btn ghost" data-a="talkStop">Stop</button></div>`
    : `<div class="btn-row wrap">${[30, 45, 60, 90].map((s) => `<button class="btn ghost" data-a="talk" data-v="${s}">${s} s each</button>`).join('')}</div>`}
        <h3 class="sub">Tally and tiebreak</h3>
        ${p ? `<div class="poll"><b>${esc(p.q)}</b><ul>${p.options.map((o, i) => `<li><span>${esc(o)}</span><button class="icon-btn" data-a="pollAdd" data-v="${i}" data-d="-1" aria-label="One fewer for ${esc(o)}">${ui('minus')}</button><b>${p.counts[i]}</b><button class="icon-btn" data-a="pollAdd" data-v="${i}" data-d="1" aria-label="One more for ${esc(o)}">${ui('plus')}</button></li>`).join('')}</ul>
          <div class="btn-row"><button class="btn" data-a="pollClose">Close and log</button><button class="btn ghost" data-a="pollClose" data-tb="1">Close, break ties at random</button></div></div>`
    : `<div class="btn-row wrap"><button class="btn ghost" data-a="poll">Yes / No</button><button class="btn ghost" data-a="poll" data-players="1">Name a player</button></div>`}
        <h3 class="sub">Score and round counters</h3>
        <ul class="counters">${v.counters.map((c) => `<li><span>${esc(c.label)}</span><button class="icon-btn" data-a="counter" data-op="dec" data-id="${c.id}" aria-label="Down">${ui('minus')}</button><b>${c.value}</b><button class="icon-btn" data-a="counter" data-op="inc" data-id="${c.id}" aria-label="Up">${ui('plus')}</button><button class="icon-btn" data-a="counter" data-op="del" data-id="${c.id}" aria-label="Remove">${ui('x')}</button></li>`).join('')}</ul>
        <div class="btn-row"><button class="btn ghost" data-a="counterAdd" data-v="Round">${ui('plus')} Round</button><button class="btn ghost" data-a="counterAdd" data-v="Score">${ui('plus')} Score</button></div>`
    : `${p ? `<div class="poll"><b>${esc(p.q)}</b><div class="btn-row wrap">${p.options.map((o, i) => `<button class="btn ${p.mine === i ? '' : 'ghost'}" data-a="pollVote" data-v="${i}">${esc(o)} · ${p.counts[i]}</button>`).join('')}</div></div>` : ''}
      ${t ? `<div class="timer-big"><span>${esc(t.label)}</span><b data-ends="${t.endsAt || ''}" data-left="${t.left ?? ''}">${mmss(left(t))}</b></div>` : ''}
      ${k ? `<div class="timer-big"><span>${esc(nameOf(v, k.order[k.i]))} is talking</span><b data-ends="${k.endsAt || ''}" data-left="${k.left ?? ''}">${mmss(left(k))}</b>${v.me && k.order[k.i] === v.me.id ? '<button class="btn" data-a="talkNext">I’m done</button>' : ''}</div>` : ''}
      ${v.counters.length ? `<ul class="counters">${v.counters.map((c) => `<li><span>${esc(c.label)}</span><b>${c.value}</b></li>`).join('')}</ul>` : ''}
      <p class="muted">The Host runs the shared timers, talk turns, tallies and counters.</p>`}
    </section>`;
  }

  // ------------------------------------------------------------ host dashboard frame
  function hostPane(v, gameControls, script) {
    if (!isHost(v)) return '';
    const playing = v.phase !== 'lobby';
    const others = v.players.filter((p) => p.id !== v.me.id);
    const players = others.map((p) => `<li><span class="who">${esc(p.name)}${p.phoneless ? ' <small class="muted">no phone</small>' : ''}${p.open ? ' <small class="muted">seat open</small>' : ''}${p.watch ? ' <small class="muted">watching</small>' : ''}${p.muted ? ' <small class="muted">muted</small>' : ''}</span>
      <span class="btn-row">${p.phoneless ? '' : `<button class="btn ghost sm" data-a="nudge" data-id="${p.id}">Nudge</button>`}<button class="btn ghost sm" data-a="mute" data-id="${p.id}">${p.muted ? 'Unmute' : 'Mute'}</button>
      ${p.phoneless || p.open ? '' : `<button class="btn ghost sm" data-a="handoff" data-id="${p.id}">Make host</button>`}
      ${p.watch || !playing ? `<button class="btn ghost sm" data-a="kick" data-id="${p.id}">Remove</button>` : p.open ? '' : `<button class="btn ghost sm" data-a="kick" data-id="${p.id}">Replace</button>`}</span></li>`).join('');
    return `<section class="pane-sec dash" aria-label="Host dashboard"><h2 class="block-title">Host dashboard</h2>
      ${playing ? `<div class="btn-row wrap">${v.paused ? `<button class="btn" data-a="resume">${ui('play')} Resume</button>` : `<button class="btn ghost" data-a="pause">${ui('pause')} Pause</button>`}
        <button class="btn ghost ${v.canUndo ? '' : 'disabled'}" data-a="undo">${ui('reset')} Undo</button>
        <button class="btn ghost" data-a="abandon">End game</button></div>` : ''}
      ${gameControls || ''}
      ${script ? `<h3 class="sub">Host script</h3><div class="script">${script}</div>` : ''}
      <h3 class="sub">Players</h3><ul class="dash-list">${players || '<li class="muted">Nobody else yet.</li>'}</ul>
      <p class="muted">“Replace” opens a seat mid-game: the next person who joins takes it over with the same secret card. “Make host” hands you off.</p>
      <h3 class="sub">Table screen</h3><p class="muted">Open this on a TV or laptop everyone can see. It never shows anything secret.</p>
      <p><a class="btn ghost" href="#/screen/${esc(v.code)}" target="_blank" rel="noopener">${ui('expand')} Open the table screen</a></p>
      <p class="muted linkrow"><a href="#/faq">Rules &amp; FAQ</a><a href="/print.html" target="_blank" rel="noopener">Print the card guide</a></p>
      <h3 class="sub">Close the room</h3><p class="muted">Ends the table for everyone, deletes the room and frees the code.</p>
      <p><button type="button" class="btn danger" data-a="closeRoom">Close room</button></p>
    </section>`;
  }

  // ------------------------------------------------------------ events
  function handle(a, el) {
    const d = el?.dataset || {};
    switch (a) {
      case 'tab': S.ui.tab = d.v; if (d.v === 'chat') S.ui.seenChat = S.view?.log.at(-1)?.n || 0; ctx.render(); window.scrollTo(0, 0); return true;
      case 'side': S.ui.side = d.v; ctx.render(); return true;
      case 'logFilter': S.ui.logFilter = d.v; ctx.render(); return true;
      case 'chat': case 'claim': {
        const inp = document.getElementById('chat-in'); const text = (inp?.value ?? S.ui.draft.chat ?? '').trim();
        if (!text) { toast('Type a message first.'); return true; }
        send({ type: a, text }); S.ui.draft.chat = ''; if (inp) { inp.value = ''; inp.blur(); } return true;
      }
      case 'hideMsg': send({ type: 'hideMsg', n: +d.n }); return true;
      case 'coin': send({ type: 'coin' }); return true;
      case 'dice': send({ type: 'dice', count: S.ui.dice.count, sides: S.ui.dice.sides }); return true;
      case 'dCount': S.ui.dice.count = Math.max(1, Math.min(6, S.ui.dice.count + +d.v)); ctx.render(); return true;
      case 'dSides': S.ui.dice.sides = +d.v; ctx.render(); return true;
      case 'privCoin': S.ui.private = `Private coin: ${rnd(2) ? 'Heads' : 'Tails'}`; ctx.render(); return true;
      case 'privDice': { const r = Array.from({ length: S.ui.dice.count }, () => 1 + rnd(S.ui.dice.sides)); S.ui.private = `Private ${S.ui.dice.count}d${S.ui.dice.sides}: ${r.join(', ')}${r.length > 1 ? ` (total ${r.reduce((x, y) => x + y, 0)})` : ''}`; ctx.render(); return true; }
      case 'pickPlayer': send({ type: 'pickPlayer' }); return true;
      case 'timer': send({ type: 'timer', secs: +d.v, label: d.label || 'Discussion' }); return true;
      case 'timerStop': case 'talkNext': case 'talkStop': case 'pause': case 'resume': case 'undo': send({ type: a }); return true;
      case 'talk': send({ type: 'talk', secs: +d.v, from: S.view?.game?.leader || S.view?.game?.speaker }); return true;
      case 'poll': send({ type: 'poll', q: d.players ? 'Who?' : 'Yes or no?', players: !!d.players }); return true;
      case 'pollVote': send({ type: 'pollVote', i: +d.v }); return true;
      case 'pollAdd': send({ type: 'pollAdd', i: +d.v, d: +d.d }); return true;
      case 'pollClose': send({ type: 'pollClose', tiebreak: !!d.tb }); return true;
      case 'counter': send({ type: 'counter', op: d.op, id: d.id }); return true;
      case 'counterAdd': send({ type: 'counter', op: 'add', label: d.v }); return true;
      case 'nudge': case 'mute': send({ type: a, id: d.id }); return true;
      case 'handoff': askConfirm(`Make ${nameOf(S.view, d.id)} the Host? You’ll stay at the table as a player.`, 'Make host').then((ok) => ok && send({ type: 'handoff', id: d.id })); return true;
      case 'kick': askConfirm(S.view.phase === 'lobby' ? `Remove ${nameOf(S.view, d.id)}?` : `Open ${nameOf(S.view, d.id)}’s seat? The next person to join takes it over, with the same secret card.`, S.view.phase === 'lobby' ? 'Remove' : 'Open seat').then((ok) => ok && send({ type: 'kick', id: d.id })); return true;
      case 'closeRoom': askConfirm('Close this room for everyone? Players will see that the host ended the game, and the code stops working.', 'Close room').then((ok) => ok && send({ type: 'close' })); return true;
      case 'abandon': askConfirm('End this game for everyone and go back to the lobby?', 'End game').then((ok) => ok && send({ type: 'abandon' })); return true;
      default: return false;
    }
  }

  // ------------------------------------------------------------ ticking, sound, wake lock, nudges
  let wake = null; const rung = new Set();
  function beep() {
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch { /* ignore */ }
    try { const A = window.AudioContext || window.webkitAudioContext; const ac = (S.audio ||= new A()); const o = ac.createOscillator(); const g = ac.createGain();
      o.frequency.value = 660; g.gain.setValueAtTime(0.12, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.6); o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.6); } catch { /* no audio */ }
  }
  function tick() {
    for (const el of document.querySelectorAll('[data-ends]')) {
      const ends = +el.dataset.ends; const lf = el.dataset.left === '' ? 0 : +el.dataset.left;
      const ms = ends ? ends - Date.now() : lf; const txt = mmss(ms);
      if (el.textContent !== txt) el.textContent = txt; // only when the second changes: no DOM write (and no layout) 4 times a second
      if (ends && ms <= 0 && !rung.has(ends)) { rung.add(ends); el.closest('.chip,.timer-big')?.classList.add('is-out'); beep(); }
    }
    const v = S.view; const running = !!(v && ((v.timer && v.timer.endsAt) || (v.talk && v.talk.endsAt)));
    if (running && !wake && 'wakeLock' in navigator && document.visibilityState === 'visible') navigator.wakeLock.request('screen').then((w) => { wake = w; w.addEventListener('release', () => { wake = null; }); }).catch(() => {});
    if (!running && wake) { wake.release().catch(() => {}); wake = null; }
  }
  setInterval(tick, 250);
  function onView(prev, v) {
    if (prev?.me && v.me && v.me.nudged > prev.me.nudged) { toast('The Host is waiting for you.'); try { navigator.vibrate?.([80, 60, 80]); } catch { /* */ } }
    if (prev && v.log.length && prev.log.length && v.log.at(-1).n !== prev.log.at(-1)?.n) {
      const last = v.log.at(-1); if (last.kind === 'tool' && S.ui.tab !== 'log') toast(last.text);
    }
    if (S.ui.tab === 'chat') S.ui.seenChat = v.log.at(-1)?.n || 0;
    if (S.ui.tab === 'host' && !v.me?.host) S.ui.tab = 'game';
  }

  return { tabbar, timerChip, chatPane, logPane, toolsPane, hostPane, handle, onView, tick, nameOf, seatedPlayers, mmss };
}

// ------------------------------------------------------------ FAQ (collapsible, with a quick search)
export function faqPage(groups, esc, ui, title = 'Questions and answers') {
  return `<main class="wrap game faq"><p class="linkrow"><a class="link" href="#/">${ui('back')} Home</a><a class="link" href="#/rules">How to play</a></p>
    <section class="stage"><h1 class="phase-title">${esc(title)}</h1>
    <label class="field"><span>Search</span><input type="search" data-faq="search" placeholder="Try “tie”, “veto”, “cards”, “timer”" autocomplete="off"></label>
    <p class="muted" data-faq="none" hidden>Nothing matches. Try a different word.</p></section>
    ${groups.map(([g, qs]) => `<section class="stage faq-group"><h2 class="block-title">${esc(g)}</h2>${qs.map(([q, a]) => `<details class="faq-q"><summary>${esc(q)}</summary><div class="faq-a">${a}</div></details>`).join('')}</section>`).join('')}
  </main>`;
}
export function wireFaqSearch(root) {
  root.addEventListener('input', (e) => {
    if (e.target.dataset.faq !== 'search') return;
    const q = e.target.value.trim().toLowerCase(); let any = false;
    for (const d of root.querySelectorAll('.faq-q')) { const hit = !q || d.textContent.toLowerCase().includes(q); d.hidden = !hit; if (hit) any = true; if (q && hit && !d.open) { d.open = true; d.dataset.s = '1'; } if (!q && d.dataset.s) { d.open = false; delete d.dataset.s; } }
    for (const s of root.querySelectorAll('.faq-group')) s.hidden = ![...s.querySelectorAll('.faq-q')].some((d) => !d.hidden);
    const none = root.querySelector('[data-faq="none"]'); if (none) none.hidden = any;
  });
}
