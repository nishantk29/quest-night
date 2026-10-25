// The one error screen: a short friendly line and two ways out. Shared by the app (errorScreen) and by the
// Worker's static error pages (src/error-page.js), so every broken state looks the same.
export const HUB_URL = 'https://gamenight.hatethespurs.com';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const errorButtons = () => `<div class="err-actions"><a class="btn big" href="${HUB_URL}">Go to Game Night home</a><a class="err-link" href="/">Back to Quest Night home</a></div>`;

// `icon` is optional pre-rendered markup (the app passes its own icon; the static page has none).
export const errorBody = ({ title, line, icon = '' }) => `<main class="wrap fatal ended err-page"><div class="empty">${icon}<h1 class="err-title">${esc(title)}</h1><p class="muted">${esc(line)}</p>${errorButtons()}</div></main>`;

export const CRASH = { title: 'Something broke', line: 'The quest took an unexpected turn. Head back and try again.' };
// Last resort when the app itself can't draw: fixed words only, never the error's own message or stack.
export const crashHtml = () => errorBody(CRASH);
export const FATAL = {
  noRoom: (code) => ({ title: 'No table with that code', line: `There’s no table with the code ${code}. Check the letters and try again.` }),
  closed: { title: 'Can’t open that table', line: 'It may have expired, or this device isn’t its Host. Head back and start again.' },
  gone: { title: 'This table has expired', line: 'Nobody played at it for a long while, so it was closed.' },
};
export const ENDED = {
  host: { title: 'The host ended the game', line: 'This table is closed and its code no longer works. Thanks for playing.' },
};
