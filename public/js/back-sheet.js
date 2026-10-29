// Back closes the open sheet (Android Back, the iOS edge swipe, the browser's Back button) instead of leaving the screen.
// While a sheet is open there is one extra history entry with the same URL. Back pops it, and the top sheet closes the
// same way a tap on its backdrop (or Escape) closes it. Closing by tap pops that entry again, so entries never pile up.
// A sheet that is still open after Back (one that has to be answered) gets no new entry, so Back is never trapped.
// top() returns the open sheet that Back may close, as { key, close }, or null. Call sync() after every repaint.
export function backClosesSheets(top, win = globalThis) {
  const h = win.history;
  const id = `s${Math.random().toString(36).slice(2, 8)}`;
  let mine = false; // our entry was pushed for the sheet now open
  let skip = 0; // popstates caused by our own history.back()
  let stuck = null; // key of a sheet that Back could not close
  const ours = () => !!h.state && h.state.backSheet === id;
  function sync() {
    if (skip) return; // our own Back is on its way; sync again when it lands
    const t = top();
    if (!t) {
      stuck = null;
      if (mine) { mine = false; if (ours()) { skip += 1; h.back(); } } // closed by tap: drop our entry
      return;
    }
    if (!mine && t.key !== stuck) { h.pushState({ ...(h.state || {}), backSheet: id }, ''); mine = true; }
  }
  win.addEventListener('popstate', () => {
    if (skip) { skip -= 1; sync(); return; }
    if (!mine || ours()) return;
    mine = false; // Back took our entry: close the top sheet
    const t = top();
    if (!t) return;
    t.close();
    const still = top();
    if (still && still.key === t.key) stuck = t.key;
    sync(); // a sheet underneath gets its own entry
  });
  return { sync };
}
