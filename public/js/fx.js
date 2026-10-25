// Quest Night animations: spring pops, flips, tiny particle bursts, stamps, number rolls, the victory
// card. CSS 3D transforms only; only transform and opacity are animated; will-change exists only while
// something is animating; nothing loops (tilt reacts to pointer/device events through one rAF).
// Everything here is cosmetic and runs on public information (or the viewer's own card on their own phone).
// Off only when the OS asks for reduced motion or the host switches animations off (no core-count check: iPhones
// report 4 cores). The one downgrade left: no blur on phones reporting <=2 GB (navigator.deviceMemory, Android Chrome).

const KEY = 'quest.fx';
const root = document.documentElement;
const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
const store = { get: () => { try { return localStorage.getItem(KEY); } catch { return null; } }, set: (v) => { try { localStorage.setItem(KEY, v); } catch { /* blocked */ } } };
const noBlur = (navigator.deviceMemory || 99) <= 2;
let userOn = store.get() !== '0';
const enabled = () => userOn && !mq?.matches;
const sync = () => { root.classList.toggle('fx-off', !enabled()); root.classList.toggle('fx-noblur', noBlur); };
mq?.addEventListener?.('change', sync);
sync();

const MAX_PARTS = 20;
const marks = new Map();
let layer;
export const dur = (ms) => ms * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-scale')) || 1);
const raf = (f) => requestAnimationFrame(f);
const $layer = () => layer || (layer = Object.assign(document.body.appendChild(document.createElement('div')), { id: 'fx' }));

// Run a Web Animation with will-change only for its lifetime. Resolves when done; never throws.
function play(el, frames, opts) {
  if (!el || !el.animate) return Promise.resolve();
  el.style.willChange = 'transform, opacity';
  const a = el.animate(frames, { fill: 'both', ...opts });
  const done = () => { el.style.willChange = ''; };
  a.finished.then(done, done);
  return a.finished.catch(() => {});
}

// ---------------------------------------------------------------- freshness (survives the app's full re-renders)
function mark(key) {
  if (!enabled() || marks.has(key)) return false;
  marks.set(key, { t: performance.now(), done: false });
  if (marks.size > 40) marks.delete(marks.keys().next().value);
  return true;
}
// A mark animates in the render that created it only; app.after() closes it, so later re-renders never replay it.
const on = (key) => { const m = marks.get(key); if (!m || m.done || !enabled()) return -1; return Math.round(performance.now() - m.t); };
// `fx.cue(key, fn)`: the first time only, run fn once the DOM for this render is in place.
const cue = (key, fn) => { if (mark(key)) raf(() => raf(fn)); };
const st = (key) => { const a = on(key); return a < 0 ? '' : ` style="--age:${a}ms"`; };

// ---------------------------------------------------------------- particles (<= 20, removed when done)
const PALETTE = { gold: ['#E4B94E', '#F6D98A', '#F3EAD3', '#EFC96A'], red: ['#F46E62', '#A8312B', '#F6D98A', '#FFD6CF'], blue: ['#8EBAF3', '#2E5A94', '#F6D98A', '#DCE9FB'] };
function burst(x, y, kind = 'gold', n = 16) {
  if (!enabled()) return;
  const count = Math.min(MAX_PARTS, n); const L = $layer(); const cols = PALETTE[kind] || PALETTE.gold;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i'); p.className = `fx-p ${kind === 'gold' || i % 3 ? 'spark' : 'chip'}`;
    p.style.cssText = `left:${x}px;top:${y}px;background:${cols[i % cols.length]}`;
    L.appendChild(p);
    const ang = (i / count) * Math.PI * 2 + Math.random() * 0.6; const d = 50 + Math.random() * 90;
    const dx = Math.cos(ang) * d; const dy = Math.sin(ang) * d;
    play(p, [{ transform: 'translate(-50%,-50%) scale(.2) rotate(0)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx * 0.8}px),calc(-50% + ${dy * 0.8 - 14}px)) scale(1) rotate(${120 + i * 40}deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy + 34}px)) scale(.4) rotate(${240 + i * 60}deg)`, opacity: 0 }],
    { duration: dur(360 + Math.random() * 40), easing: 'cubic-bezier(.22,1,.36,1)' }).then(() => p.remove());
  }
}
const centre = (el) => { const r = el?.getBoundingClientRect(); return r ? [r.left + r.width / 2, r.top + r.height / 2] : [innerWidth / 2, innerHeight / 3]; };
const burstAt = (sel, kind, n) => burst(...centre(document.querySelector(sel)), kind, n);

// Stamp-like slam for results.
function stamp(text, tone = 'red') {
  if (!enabled()) return;
  const s = Object.assign(document.createElement('div'), { className: `fx-stamp is-${tone}`, textContent: text });
  s.setAttribute('aria-hidden', 'true'); $layer().appendChild(s);
  play(s, [{ transform: 'translate(-50%,-50%) rotate(-9deg) scale(2.6)', opacity: 0 }, { transform: 'translate(-50%,-50%) rotate(-9deg) scale(.9)', opacity: 1, offset: 0.2, easing: 'cubic-bezier(.3,1.6,.5,1)' },
      { transform: 'translate(-50%,-50%) rotate(-9deg) scale(1)', opacity: 1, offset: 0.3 }, { transform: 'translate(-50%,-50%) rotate(-9deg) scale(1)', opacity: 1, offset: 0.8 }, { transform: 'translate(-50%,-50%) rotate(-9deg) scale(1.04)', opacity: 0 }],
  { duration: dur(600), easing: 'cubic-bezier(.22,1,.36,1)' }).then(() => s.remove());
}

// A warm full-screen wash (the Lantern): opacity only.
function glow(tone = 'gold') {
  if (!enabled()) return;
  const g = Object.assign(document.createElement('div'), { className: `fx-glow is-${tone}` }); $layer().appendChild(g);
  play(g, [{ opacity: 0 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }], { duration: dur(500), easing: 'cubic-bezier(.22,1,.36,1)' }).then(() => g.remove());
}

// Numbers that roll: any [data-roll="id"] whose text changed since the last render slides in.
const seen = new Map();
function rolls(rootEl) {
  for (const el of rootEl.querySelectorAll('[data-roll]')) {
    const id = el.dataset.roll; const prev = seen.get(id); seen.set(id, el.textContent);
    if (prev != null && prev !== el.textContent && enabled()) play(el, [{ transform: 'translateY(55%) scale(.7)', opacity: 0 }, { transform: 'translateY(-4%) scale(1.05)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], { duration: dur(300), easing: 'cubic-bezier(.22,1,.36,1)', fill: 'none' });
  }
}

// Drop the animation class (and with it will-change) as soon as each element finishes.
document.addEventListener('animationend', (e) => { if (e.target.classList?.contains('fx-a')) e.target.classList.remove('fx-a'); }, true);

// ---------------------------------------------------------------- tilt: pointer, and mouse only
let tiltEl = null; let tiltRaf = 0; let tiltXY = null;
const CARDS = '[data-tilt]'; // the secret card, mouse only
const setTilt = (el, nx, ny) => { // nx, ny in -1..1
  const k = 7;
  el.style.setProperty('--ry', `${(nx * k).toFixed(2)}deg`); el.style.setProperty('--rx', `${(-ny * k).toFixed(2)}deg`);
  el.style.setProperty('--hx', nx.toFixed(2)); el.style.setProperty('--hy', ny.toFixed(2));
};
function queueTilt(el, nx, ny) {
  tiltEl = el; tiltXY = [nx, ny];
  if (tiltRaf) return;
  tiltRaf = raf(() => { tiltRaf = 0; if (tiltEl?.isConnected) setTilt(tiltEl, ...tiltXY); });
}
document.addEventListener('pointermove', (e) => {
  if (!enabled() || e.pointerType === 'touch') return; // touch gets the instant :active press
  const el = e.target.closest?.(CARDS); if (!el) return;
  const r = el.getBoundingClientRect();
  queueTilt(el, Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2)), Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2)));
}, { passive: true });
document.addEventListener('pointerout', (e) => { const el = e.target.closest?.(CARDS); if (el && !el.contains(e.relatedTarget)) queueTilt(el, 0, 0); }, { passive: true });

// ---------------------------------------------------------------- the victory card
let vic = null;
function closeVictory() {
  if (!vic) return;
  const v = vic; vic = null;
  removeEventListener('keydown', v.key);
  v.el.remove();
}
// o = { side, title, text (reason), status ('You won!' | 'You lost' | ''), crest (trusted svg html), roles [{name, role, side, icon(html)}], onAgain (host only), }
function victory(o) {
  closeVictory();
  const el = document.createElement('div'); el.className = `fx-victory a-${o.side}`;
  el.innerHTML = `<div class="vc-wrap"><div class="vc-tilt glass" role="dialog" aria-labelledby="vc-title">
      <div class="vc-crest">${o.crest}</div>
      <h2 id="vc-title"></h2><p class="vc-text"></p>${o.status ? `<p class="vc-status"></p>` : ''}
      <ul class="vc-roles"></ul>
      <div class="vc-btns">${o.onAgain ? '<button type="button" class="btn big" data-vc="again">Play again</button>' : ''}<button type="button" class="btn ${o.onAgain ? 'ghost' : 'big'}" data-vc="close">Close</button></div></div></div>`;
  el.querySelector('#vc-title').textContent = o.title; el.querySelector('.vc-text').textContent = o.text;
  if (o.status) el.querySelector('.vc-status').textContent = o.status;
  const ul = el.querySelector('.vc-roles');
  (o.roles || []).forEach((r, i) => { const li = document.createElement('li'); li.className = `a-${r.side}`; li.style.setProperty('--i', i); li.innerHTML = r.icon; const s = document.createElement('span'); const b = document.createElement('b'); b.textContent = r.name; const sm = document.createElement('small'); sm.textContent = r.role; s.append(b, sm); li.append(s); ul.append(li); });
  if (!o.roles?.length) ul.remove();
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-vc]'); if (!b) return; if (b.dataset.vc === 'again') o.onAgain(); closeVictory(); });
  const key = (e) => { if (e.key === 'Escape') closeVictory(); };
  addEventListener('keydown', key);
  $layer().appendChild(el);
  vic = { el, key, tilt: el.querySelector('.vc-tilt') };
  const on_ = enabled();
  el.classList.toggle('is-fx', on_);
  if (on_) {
    raf(() => { const [x, y] = centre(vic?.tilt); burst(x, y - 60, 'gold', 20); });
    setTimeout(() => el.classList.remove('is-fx'), dur(700)); // will-change (in the .is-fx rules) ends with the pop
  }
  if (!o.noFocus) el.querySelector('[data-vc]')?.focus({ preventScroll: true });
}

export const fx = {
  enabled, mark, on, st, cue, burst, burstAt, stamp, glow, rolls, victory, closeVictory,
  isUserOn: () => userOn,
  setUserOn(v) { userOn = !!v; store.set(v ? '1' : '0'); sync(); },
  after(rootEl) { rolls(rootEl); for (const m of marks.values()) m.done = true; },
};
