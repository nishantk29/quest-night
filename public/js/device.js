// Small device helpers, all feature-detected: haptic ticks, Screen Wake Lock, fullscreen.
export function haptic(ms = 12, nav = globalThis.navigator) {
  try { return !!nav?.vibrate?.(ms); } catch { return false; }
}

// The wake lock is only wanted while a game is running (not in the lobby, not after the end).
export const wantsWakeLock = (view) => !!view && !!view.game && view.phase !== 'lobby' && view.phase !== 'over';

// Holds a screen wake lock while `set(true)` is in force and re-acquires it when the tab comes back
// (the browser drops it whenever the page is hidden).
export function createWakeLock(nav = globalThis.navigator, doc = globalThis.document) {
  let sentinel = null; let want = false; let busy = false;
  const acquire = async () => {
    if (!want || busy || sentinel || !nav?.wakeLock?.request || doc?.visibilityState !== 'visible') return;
    busy = true;
    try {
      const s = await nav.wakeLock.request('screen');
      if (!want) { s.release?.().catch?.(() => {}); } else { sentinel = s; s.addEventListener?.('release', () => { if (sentinel === s) sentinel = null; }); }
    } catch { sentinel = null; }
    busy = false;
  };
  doc?.addEventListener?.('visibilitychange', acquire);
  return {
    set(on) {
      want = !!on;
      if (want) acquire();
      else if (sentinel) { const s = sentinel; sentinel = null; Promise.resolve(s.release?.()).catch(() => {}); }
    },
    get held() { return !!sentinel; },
  };
}

export const canFullscreen = (el) => !!(el && (el.requestFullscreen || el.webkitRequestFullscreen));
export function enterFullscreen(el) {
  try { const p = (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el); return Promise.resolve(p).then(() => true, () => false); } catch { return Promise.resolve(false); }
}
