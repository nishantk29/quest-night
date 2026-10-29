// One label per intent (Nishant approved 2026-10-29 6:03 PM ET; run/copy/label-list.md; DESIGN-SKILL §10).
// Copy this file into each game's test/kit/ (copy it, don't fork it). Each entry: the label to use and the variants that
// fail the gate. Patterns are anchored to the WHOLE label (trimmed), so prose like "Nobody died" never matches.
export const INTENTS = [
  { intent: 'host a room', use: 'Host a game', banned: [/^Open Table$/i, /^Open Chamber$/i, /^Host a table$/i, /^New game$/i] },
  { intent: 'open the join screen / submit', use: 'Join a game / Join', banned: [/^Join (Table|Room|Chamber|game|room|a table)$/i, /^Take (a )?Seat$/i] },
  { intent: 'rejoin', use: 'Rejoin', banned: [/^Rejoin room$/i, /^Back to your seat\b/i] },
  { intent: 'move on', use: 'Next: <what comes>', banned: [/^Continue$/i, /^Done, /i, /^Next speaker$/i, /^Next player$/i, /^Next round$/i] },
  { intent: 'deal', use: 'Deal N roles', banned: [/^Deal Cards$/, /^Deal roles$/i] },
  { intent: 'start', use: 'Start …', banned: [/^Begin\b/i, /^Start Game$/, /^Start First Party$/i, /^Start Passing$/, /^Start Vote$/] },
  { intent: 'ready', use: 'I’m ready', banned: [/^I[’']m Ready$/] },
  { intent: 'see / hide a secret', use: 'See my role / Hide / Hide and pass on', banned: [/^Show my role$/i, /^Hide Cards$/, /^Hide and pass back$/i] },
  { intent: 'reveal to the table', use: 'Reveal / Show scores / Show the winner', banned: [/^Show card( again)?$/i, /^Show Scores$/, /^See the Winner$/i] },
  { intent: 'dismiss', use: 'Close (Done after a saved edit)', banned: [/^Got it$/i] },
  { intent: 'back', use: 'Back / Back to <place>', banned: [/^Back to Players$/, /^Back to home$/i] },
  { intent: 'site home / hub', use: '<Game> home / All games / Go to Game Night home', banned: [/^Home$/, /^All Games$/, /^See all games$/i] },
  { intent: 'put off', use: 'Not now', banned: [/^Not Now$/] },
  { intent: 'confirm destructive', use: 'repeat the verb (Restart game, End game, Veto)', banned: [/^Yes, /i, /^Confirm\b/i, /^Restart now$/i, /^Restart game…$/, /^End game for everyone$/i, /^Use it anyway$/i] },
  { intent: 'stop', use: 'End game (host) / Leave game (player)', banned: [/^Leave room$/i, /^Leave this game$/i] },
  { intent: 'pick nobody', use: 'No one', banned: [/^Nobody$/, /^None$/] },
  { intent: 'skip', use: 'Skip / Skip <step>, sentence case, no brackets', banned: [/^Skip .*\(/i, /^Skip the (Lantern|Assassin|Rest)\b/, /^Skip to Nomination$/, /^Skip Guess\b/] },
  { intent: 'share', use: 'Show QR code / Copy link', banned: [/^Show QR$/i, /^Copy Link$/] },
  { intent: 'save', use: 'Save / Save preset', banned: [/^Save as a preset$/i, /^Save for later$/i, /^Save (name|role)$/i] },
  { intent: 'undo', use: 'Undo', banned: [/^Undo last step$/i] },
  { intent: 'full screen', use: 'Full screen', banned: [/^Tap for Full Screen$/i] },
  { intent: 'title case', use: 'sentence case', banned: [/^Shuffle Seats$/, /^Add Seat$/, /^Pass the Crown$/, /^It Was Merlin$/, /^Propose Veto$/] },
];
const norm = (s) => String(s).replace(/\s+/g, ' ').replace(/^[\s·•×+−-]+|[\s·•]+$/g, '').trim();
// Returns issues for one visible label. opts.proper: words allowed to be capitalised mid-label (game and role names).
export function lintLabel(label, { proper = [] } = {}) {
  const t = norm(label); const out = [];
  if (!t) return out;
  for (const it of INTENTS) for (const re of it.banned) if (re.test(t)) out.push(`"${t}": banned variant for "${it.intent}", use "${it.use}"`);
  const ok = new Set(['I', 'I’m', "I'm", 'QR', 'FAQ', 'OK', ...proper]);
  const words = t.split(' ');
  if (words.length > 1) for (let i = 1; i < words.length; i++) {
    const w = words[i]; if (/[.?!:]$/.test(words[i - 1]) || words[i - 1] === "/") continue; // a new sentence or "Next: <Step>"
    const bare = w.replace(/^[^\p{L}]+|[^\p{L}’']+$/gu, '');
    if (!bare || !/^\p{Lu}/u.test(bare) || ok.has(bare) || /^\p{Lu}{2,}$/u.test(bare)) continue;
    out.push(`"${t}": Title Case word "${bare}" (sentence case, or add it to the proper-noun list)`); break;
  }
  return out;
}
// Visible labels in shipped JS/HTML source: <button> and button-styled <a> inner text, `label: '…'` and
// btn(…, '…') helper strings. ${…} becomes {x}; tags and icons are dropped.
export function extractLabels(src) {
  const out = [];
  // first text chunk only (a button with a title and a note is labelled by its title); template parts become spaces
  const clean = (s) => { const t = s.replace(/<svg[\s\S]*?<\/svg>/g, '\n').replace(/\$\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g, ' ').replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
    const first = t.split('\n').map(norm).find(Boolean) || ''; return /[=<>'"`{}]|\b[A-Z_]{4,}\b/.test(first) ? '' : first; };
  for (const m of src.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) if (m[1].length < 400) out.push(clean(m[1]));
  for (const m of src.matchAll(/<a\b[^>]*class=["'][^"']*\b(?:btn|f-btn|cta)\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/g)) if (m[1].length < 400) out.push(clean(m[1]));
  for (const m of src.matchAll(/\blabel\s*:\s*(['"`])([^'"`\n$]{1,60})\1/g)) out.push(norm(m[2]));
  for (const m of src.matchAll(/\bbtn\(\s*(['"`])[^'"`]*\1\s*,\s*(['"`])[^'"`]*\2\s*,\s*(['"`])([^'"`\n$]{1,60})\3/g)) out.push(norm(m[4]));
  return out.filter(Boolean);
}
// Banned variants only (no case check), for any whole string literal in shipped JS: catches labels that reach a button
// through a variable or a ternary. Prose never matches because every pattern is anchored to the whole string.
export function lintLiteral(str) {
  const t = norm(str); const out = [];
  if (!t || t.length > 60) return out;
  for (const it of INTENTS) for (const re of it.banned) if (re.test(t)) out.push(`"${t}": banned variant for "${it.intent}", use "${it.use}"`);
  return out;
}
