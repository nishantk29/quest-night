// Hold-to-reveal for private info (role card, who you see). Pure logic with injectable timers so it can be tested.
// Press and hold: visible until you let go. Quick tap: visible for `showMs`, or until you tap again.
// A hold is capped at `maxMs` so a phone left on the table re-blurs itself.
export function createReveal({ onChange, holdMs = 350, showMs = 4000, maxMs = 12000, set = setTimeout, clear = clearTimeout, now = () => Date.now() } = {}) {
  let shown = false; let pressed = false; let pressAt = 0; let timer = null; let ignoreRelease = false;
  const stop = () => { if (timer != null) { clear(timer); timer = null; } };
  const hide = () => { stop(); pressed = false; if (shown) { shown = false; onChange?.(false); } };
  return {
    get shown() { return shown; },
    press() {
      if (pressed) return;
      stop();
      if (shown) { hide(); ignoreRelease = true; return; } // a tap on a visible card hides it
      pressed = true; ignoreRelease = false; pressAt = now(); shown = true; onChange?.(true);
      timer = set(hide, maxMs);
    },
    release() {
      if (ignoreRelease) { ignoreRelease = false; return; }
      if (!pressed) return;
      pressed = false; stop();
      if (now() - pressAt >= holdMs) hide(); else timer = set(hide, showMs);
    },
    hide,
  };
}
