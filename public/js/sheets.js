// In-app bottom sheets (native <dialog>, so focus is trapped and Escape closes). They live outside #app, so the
// app's re-renders never close them; a new game (gameNo change) closes every open one.
const open = new Set();

export function closeSheets() { for (const close of [...open]) close(); }
export const sheetOpen = () => open.size > 0;

// buttons: [{ label, cls, onClick, close = true }]. Returns { close }.
export function openSheet({ title, bodyHtml = '', buttons = [], cls = '', onClose = null }) {
  const dlg = document.createElement('dialog');
  dlg.className = `confirm-sheet info-sheet ${cls}`.trim();
  dlg.setAttribute('aria-labelledby', 'sheet-title');
  dlg.innerHTML = `<div class="sheet-head"><h2 class="sheet-title" id="sheet-title"></h2><button type="button" class="icon-btn x-btn" data-sheet="x" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button></div>
    <div class="sheet-body">${bodyHtml}</div>${buttons.length ? '<div class="btn-row sheet-actions"></div>' : ''}`;
  dlg.querySelector('#sheet-title').textContent = title;
  let done = false;
  const close = () => { if (done) return; done = true; open.delete(close); try { dlg.close(); } catch { /* not open */ } dlg.remove(); onClose?.(); };
  const row = dlg.querySelector('.sheet-actions');
  for (const b of buttons) {
    const el = document.createElement('button');
    el.type = 'button'; el.className = `btn ${b.cls || ''}`.trim(); el.textContent = b.label;
    el.addEventListener('click', () => { if (b.close !== false) close(); b.onClick?.(); });
    row.append(el);
  }
  dlg.querySelector('[data-sheet="x"]').addEventListener('click', close);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  document.body.append(dlg);
  open.add(close);
  dlg.showModal();
  return { close };
}
