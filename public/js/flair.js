// Quest Night flair: gentle card tilt (mouse on hover pointers, a light press-tilt on touch) and the saved-table check.
// Transform only, rAF-throttled, no idle loop. Skipped for reduced motion and when the Animations switch is off.
const CARD = '[data-card],.path,.side-card,.more-card,.role-token,.how-sec li';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const off = () => reduced.matches || document.documentElement.classList.contains('fx-off');
let el = null; let raf = 0; let xy = [0, 0]; let touchMode = false;

function apply() {
  raf = 0;
  if (!el?.isConnected) return;
  const k = touchMode ? 3 : 6;
  el.style.setProperty('--cry', `${(xy[0] * k).toFixed(2)}deg`);
  el.style.setProperty('--crx', `${(-xy[1] * k).toFixed(2)}deg`);
  el.style.setProperty('--cgx', `${(50 + xy[0] * 40).toFixed(1)}%`);
  el.style.setProperty('--cgy', `${(50 + xy[1] * 40).toFixed(1)}%`);
}
function reset(c) {
  if (!c) return;
  c.removeAttribute('data-tilting');
  for (const p of ['--cry', '--crx', '--cgx', '--cgy']) c.style.removeProperty(p);
}
function aim(e) {
  if (off()) return;
  const c = e.target.closest?.(CARD);
  if (!c) { if (el) { reset(el); el = null; } return; }
  if (c !== el) { reset(el); el = c; c.setAttribute('data-tilting', ''); }
  const r = c.getBoundingClientRect();
  xy = [Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2)), Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2))];
  touchMode = e.pointerType === 'touch';
  if (!raf) raf = requestAnimationFrame(apply);
}
document.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch' && !e.isPrimary) return; aim(e); }, { passive: true });
document.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') aim(e); }, { passive: true });
for (const t of ['pointerup', 'pointercancel']) document.addEventListener(t, (e) => { if (e.pointerType === 'touch' && el) { reset(el); el = null; } }, { passive: true });
document.addEventListener('pointerleave', () => { reset(el); el = null; }, { passive: true });
document.addEventListener('pointerout', (e) => { if (el && e.pointerType !== 'touch' && !el.contains(e.relatedTarget)) { reset(el); el = null; } }, { passive: true });

// A saved "Back to table" chip goes away by itself once the host has closed that room.
export async function pruneClosedRooms(root, forget) {
  for (const row of root.querySelectorAll('.resume-row[data-room]')) {
    const code = row.dataset.room;
    try {
      const r = await fetch(`/api/room/${code}`);
      if (r.status === 404) { forget(code); row.remove(); }
    } catch { /* offline: keep the chip */ }
  }
}
