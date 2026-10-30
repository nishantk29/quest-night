// Setup carousel, presets page and customize page: markup only. app.js owns state, events and sending.
// Everything returns HTML strings; every user-supplied string goes through esc().
import { ROLES, MIN_PLAYERS, EVIL_COUNT, QUEST_SIZES } from './rules.js';
import { SETUP_STEPS } from './config-defaults.js';
import { SEATING, SEATING_IDS, seatingLabel, nextLabel } from './setup.js';
import { PRESETS, countsOf, rangeText, misfit, fits, ROLE_LINE, ROLE_ORDER, DIFFICULTY_PIPS } from './presets.js';

const CHEV = '<svg class="cs-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
const CHEV_L = '<svg class="cs-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const plural = (n, a, b) => (n === 1 ? a : b);

export const sideClass = (id) => `a-${ROLES[id].side}`;
export const tokens = (roles, glyph, max = 6) => {
  const c = countsOf(roles); const ids = ROLE_ORDER.filter((id) => c.has(id));
  const shown = ids.slice(0, max); const more = ids.length - shown.length;
  return `<span class="pc-tokens">${shown.map((id) => `<span class="pc-tok"><span class="qtok ${sideClass(id)}" title="${ROLES[id].name}">${glyph(ROLES[id].icon)}</span>${c.get(id) > 1 ? `<b class="pc-x">×${c.get(id)}</b>` : ''}</span>`).join('')}${more > 0 ? `<b class="pc-x">+${more}</b>` : ''}</span>`;
};
const pips = (d) => `<span class="pips" aria-hidden="true">${[1, 2, 3].map((i) => `<i class="${i <= DIFFICULTY_PIPS[d] ? 'on' : ''}"></i>`).join('')}</span>`;

export function roleRows(roles, glyph, esc) {
  const c = countsOf(roles);
  return `<ul class="cs-rows">${ROLE_ORDER.filter((id) => c.has(id)).map((id) => `<li><span class="qtok big ${sideClass(id)}">${glyph(ROLES[id].icon)}</span><span class="cs-t"><b>${esc(ROLES[id].name)}</b><span>${esc(ROLE_LINE[id])}</span></span><span class="cs-n">${c.get(id)}</span></li>`).join('')}</ul>`;
}

// The reason line and Next button. A disabled Next stays focusable and names why through aria-describedby.
function dock(step, problem, esc, label) {
  const why = problem ? `<p class="cs-why" id="cs-why" role="note">${esc(problem.text)} ${problem.fix ? `<button type="button" class="cs-link" data-a="csFix" data-go="${problem.fix.go}" ${problem.fix.focus ? `data-focus="${problem.fix.focus}"` : ''}>${esc(problem.fix.label)}</button>` : ''}</p>` : '';
  return `<div class="cs-dock">${why}<button type="button" class="cs-btn" data-a="${step === 3 ? 'csDeal' : 'csNext'}" ${problem ? 'aria-disabled="true" aria-describedby="cs-why"' : ''}>${esc(label || nextLabel(step))}</button></div>`;
}

export function progress(step) {
  const dots = SETUP_STEPS.map((name, i) => `<li><button type="button" class="cs-dot ${i === step ? 'now' : i < step ? 'done' : ''}" data-a="csGo" data-s="${i}" aria-label="${name}, step ${i + 1}${i === step ? ', current' : i < step ? ', done' : ''}" ${i === step ? 'aria-current="step"' : ''} ${i > step ? 'aria-disabled="true" tabindex="-1"' : ''}>${i + 1}</button></li>`).join('');
  return `<div class="cs-top">${step > 0 ? `<button type="button" class="cs-back" data-a="csBack">${CHEV_L}Back</button>` : '<span></span>'}<div class="cs-prog"><ol>${dots}</ol><span>Step ${step + 1} of ${SETUP_STEPS.length}: ${SETUP_STEPS[step]}</span></div></div>`;
}

const hd = (t, sub, esc) => `<header class="cs-head"><h1 class="cs-h" tabindex="-1" id="cs-h">${esc(t)}</h1>${sub ? `<p class="cs-sub">${esc(sub)}</p>` : ''}</header>`;

// ---- step 1: Players
function stepPlayers(c) {
  const { v, esc, ui, glyph, draft, link } = c;
  const seats = v.players;
  const chips = seats.map((p) => `<li class="cs-chip ${p.watch ? 'is-off' : ''}"><span class="cs-ini">${esc((p.name[0] || '?').toUpperCase())}</span><span class="cs-nm">${esc(p.name)}${p.host ? '<small>Host</small>' : ''}${p.watch ? '<small>sits out</small>' : ''}</span>${p.phoneless ? '' : `<span class="cs-dev" title="On their own phone" role="img" aria-label="on their own phone">${ui('phone')}</span>`}${p.host ? '' : `<button type="button" class="cs-x" data-a="kick" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">${ui('x')}</button>`}</li>`).join('');
  const n = seats.filter((p) => !p.watch).length;
  return `${hd('Who’s playing?', '', esc)}
    <div class="cs-code"><span>Players join with code <b class="cs-code-v">${esc(v.code)}</b></span><span class="cs-code-act"><button type="button" class="cs-link" data-a="qrFull" data-link="${esc(link)}" data-code="${esc(v.code)}">Show QR code</button><button type="button" class="cs-link" data-a="copy" data-link="${esc(link)}">Copy link</button></span></div>
    <div class="cs-count"><b>${n} ${plural(n, 'player', 'players')}</b><span>${ui('phone')} joined on their own phone</span></div>
    <ul class="cs-chips">${chips}</ul>
    <div class="cs-add"><input id="cs-name" data-i="seatName" maxlength="20" placeholder="Add a name" aria-label="Add a name" enterkeyhint="done" autocomplete="off" value="${esc(draft.seatName || '')}"><button type="button" class="cs-sec" data-a="addSeat">Add</button></div>
    <p class="cs-callout">${ui('phone')} A name you add here plays on this phone.</p>`;
}

// ---- step 2: Preset
export function presetCard(p, n, c, current) {
  const { esc, glyph } = c;
  const mix = p.mix(n) || p.mix(p.min) || [];
  return `<article class="cs-vellum"><div class="cs-vhead"><h2>${esc(p.name)}</h2><span class="cs-diff">${p.difficulty} ${pips(p.difficulty)}</span></div>
    <p>${esc(p.vibe)}</p>${tokens(mix, glyph)}
    <p class="cs-small">${current.list?.error ? esc(current.list.error) : `${n - EVIL_COUNT[n]} Loyal and ${EVIL_COUNT[n]} Evil, as the rules set for ${n}.`}</p></article>`;
}
function stepPreset(c) {
  const { esc, glyph, st, n } = c;
  const p = st.preset; const nn = Math.max(MIN_PLAYERS, Math.min(10, n));
  let card;
  if (p) card = presetCard(p, nn, c, st);
  else card = `<article class="cs-vellum"><div class="cs-vhead"><h2>Custom setup</h2></div><p>Your own mix of characters.</p>${tokens(st.list.roles || [], glyph)}<p class="cs-small">${st.list.error ? esc(st.list.error) : `${nn - EVIL_COUNT[nn]} Loyal and ${EVIL_COUNT[nn]} Evil, as the rules set for ${nn}.`}</p></article>`;
  const roles = st.list.roles || [];
  return `${hd('Choose the court', `For ${n} ${plural(n, 'player', 'players')}`, esc)}${card}
    <div class="cs-links"><button type="button" class="cs-link big" data-a="presetsOpen">Change preset ${CHEV}</button><button type="button" class="cs-link big" data-a="customize">Customize ${CHEV}</button></div>
    ${roles.length ? roleRows(roles, glyph, esc) : ''}`;
}

// ---- step 3: Seating
function stepSeating(c) {
  const { esc, ui, seating, v } = c;
  const ico = { own: 'phone', one: 'user', mixed: 'cards' };
  return `${hd('How is everyone playing?', '', esc)}<div class="cs-opts" role="radiogroup" aria-label="How everyone plays">${SEATING_IDS.map((id) => `<button type="button" role="radio" aria-checked="${seating === id}" class="cs-opt ${seating === id ? 'on' : ''}" data-a="seating" data-v="${id}"><span class="cs-oi">${ui(ico[id])}</span><span class="cs-t"><b>${SEATING[id].label}</b><span>${SEATING[id].blurb}</span></span><span class="cs-radio" aria-hidden="true"></span></button>`).join('')}</div>
    ${seating === 'mixed' ? '<p class="cs-callout">Mixed uses real cards for roles, votes and quest cards. People on their own phones still see the board.</p>' : ''}`;
}

// ---- step 4: Review and deal
function stepDeal(c) {
  const { v, esc, glyph, st, n, seating, advanced, advancedHtml } = c;
  const names = v.players.filter((p) => !p.watch).map((p) => p.name);
  const who = names.length > 3 ? `${esc(names.slice(0, 3).join(', '))} and ${names.length - 3} more` : esc(names.join(', '));
  const preset = st.preset ? st.preset.name : 'Custom setup';
  const row = (k, val, step) => `<li class="cs-sum"><span class="cs-k">${k}</span><span class="cs-v">${val}</span><button type="button" class="cs-link" data-a="csGo" data-s="${step}" aria-label="Edit ${k.toLowerCase()}">Edit</button></li>`;
  return `${hd('Ready to deal?', '', esc)}
    <p class="cs-roomline">Room <b>${esc(v.code)}</b></p>
    <ul class="cs-sums">${row('Players', `${names.length}: ${who}`, 0)}${row('Roles', esc(preset), 1)}${row('Seating', esc(seatingLabel(seating, v.players)), 2)}</ul>
    ${st.list.roles ? `<div class="cs-mini"><span>Roles in this game</span>${tokens(st.list.roles, glyph, 8)}</div>` : ''}
    <details class="cs-adv" data-adv ${advanced ? 'open' : ''}><summary><span>Advanced</span><small>${esc(c.advSummary)}</small></summary><div class="cs-adv-body">${advancedHtml}</div></details>`;
}

// The whole carousel for the host. ctx: { v, S, esc, ui, glyph, st, step, seating, advanced, advancedHtml, advSummary, draft, link, dir }
export function carousel(c) {
  const { step, st, esc } = c;
  const body = [stepPlayers, stepPreset, stepSeating, stepDeal][step](c);
  const problem = st.problems[step];
  return `<section class="cs" data-step="${step}" aria-label="Setup">${progress(step)}<div class="cs-view"><div class="cs-card" id="cs-card" data-dir="${c.dir || ''}">${body}</div></div>${dock(step, problem, esc, step === 3 ? nextLabel(3, c.n) : null)}</section>`;
}

// ---- presets page
function presetRow(p, n, c, picked) {
  const { esc, glyph } = c;
  const ok = fits(p, n);
  const mix = p.mix(n) || p.mix(p.min) || [...p.good, ...p.evil];
  return `<li class="pr ${ok ? '' : 'off'} ${picked ? 'cur' : ''}"><button type="button" class="pr-main" data-a="presetPreview" data-id="${esc(p.id)}" aria-label="${esc(p.name)}, ${ok ? rangeText(p) : misfit(p, n)}">
      <span class="pr-top"><h3>${esc(p.name)}</h3>${picked ? `<span class="pr-sel">${c.ui('check')} Picked</span>` : ''}</span>
      <span class="pr-vibe">${esc(p.vibe)}</span>
      <span class="pr-meta">${ok ? rangeText(p) : `Needs ${p.min}+ players`}<span>${p.difficulty} ${pips(p.difficulty)}</span>${p.saved ? '<span class="pr-saved">★ Saved</span>' : ''}</span>
      ${tokens(mix, glyph)}</button>${p.saved ? `<button type="button" class="pr-more" data-a="savedMenu" data-id="${esc(p.id)}" aria-label="Rename or delete ${esc(p.name)}">${c.ui('pencil')}</button>` : ''}</li>`;
}
export function presetsPage(c) {
  const { esc, n, saved, pickedId } = c;
  const rec = PRESETS[0];
  const rest = PRESETS.slice(1);
  return `<section class="cs cs-page" aria-label="Presets"><div class="cs-top"><button type="button" class="cs-back" data-a="presetsBack">${CHEV_L}Back</button></div>
    <div class="cs-view"><div class="cs-card">${hd('Presets', `${n} ${plural(n, 'player', 'players')}. Tap one to see what it sets.`, esc)}
    <h2 class="pr-group">Recommended for ${n}</h2><ul class="pr-list">${presetRow(rec, n, c, pickedId === rec.id)}</ul>
    <h2 class="pr-group">Built in</h2><ul class="pr-list">${rest.map((p) => presetRow(p, n, c, pickedId === p.id)).join('')}</ul>
    ${saved.length ? `<h2 class="pr-group">Saved on this phone</h2><ul class="pr-list">${c.savedList.map((p) => presetRow(p, n, c, pickedId === p.id)).join('')}</ul><p class="cs-callout">Saved presets stay on this phone only.</p>` : ''}</div></div></section>`;
}

// The preview sheet body (outside #app, so it is built once and static).
export function previewBody(p, n, { esc, glyph }) {
  const mix = p.mix(n);
  const why = mix ? '' : `<p class="note is-warn">${esc(misfit(p, n))}</p>`;
  const rows = mix ? `<h3 class="pv-h">Roles for ${n} players</h3>${roleRows(mix, glyph, esc)}` : '';
  return `<p class="muted">${esc(p.vibe)} ${p.difficulty}, ${rangeText(p)}.${p.saved ? ' ★ Saved on this phone.' : ''}</p>${why}${rows}`;
}

// ---- customize page
export function customizePage(c) {
  const { esc, n, steppers, draft, st } = c;
  return `<section class="cs cs-page" aria-label="Customize"><div class="cs-top"><button type="button" class="cs-back" data-a="presetsBack">${CHEV_L}Back</button></div>
    <div class="cs-view"><div class="cs-card">${hd('Customize', `For ${n} ${plural(n, 'player', 'players')}. Switch characters on or off.`, esc)}
    <div class="cs-add cs-save"><input data-i="presetName" maxlength="24" placeholder="Name this setup" aria-label="Name this setup" autocomplete="off" value="${esc(draft.presetName || '')}"><button type="button" class="cs-sec" data-a="savePreset" ${st.list.error ? 'aria-disabled="true"' : ''}>Save preset</button></div>
    ${steppers}
    <p class="cs-callout">Saved presets stay on this phone only.</p></div></div>
    <div class="cs-dock"><button type="button" class="cs-btn" data-a="presetsBack">Done</button></div></section>`;
}
