// Quest Night FAQ: short answers that match the rules exactly as this app runs them.
import { ROLES, OPTIONAL, HOUSE_DEFAULTS, EVIL_COUNT, MIN_PLAYERS, MAX_PLAYERS, MAX_REJECTS, QUESTS_TO_WIN, failsNeeded, proposalPasses } from './rules.js';

// Numbers in the answers come from rules.js, so they can't drift from the game (test/faq-numbers.test.js).
const SIZES = Object.keys(EVIL_COUNT).map(Number);
const WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
const groupBy = (f) => { const out = []; for (const n of SIZES) { const v = f(n); const last = out[out.length - 1]; if (last && last.v === v) last.ns.push(n); else out.push({ v, ns: [n] }); } return out; };
const sizesText = (ns) => (ns.length === 1 ? `${ns[0]}` : ns.length === 2 ? `${ns[0]} or ${ns[1]}` : `${ns[0]}–${ns[ns.length - 1]}`);
const majority = (n) => { let a = 0; while (!proposalPasses(a, n)) a++; return a; };
const MAJORITY_TEXT = groupBy(majority).map(({ v, ns }) => `${v} of ${sizesText(ns)}`).join(', ');
const EVIL_TEXT = groupBy((n) => EVIL_COUNT[n]).map(({ v, ns }) => `${v} at ${sizesText(ns).replace(' or ', '–')}`).join(', ');
const TWO_FAIL_FROM = SIZES.find((n) => failsNeeded(n, 3) === 2);
import { COMMON_HOUSE, MODE_PRESETS } from './table.js';

// What each role sees or does. Keyed by the role ids in rules.js (the game's own role data): a test fails if a role is
// added to, or removed from, the game without this list changing with it, and the Roles section below is built from ROLES.
const ROLE_FAQ = {
  merlin: 'Sees every Evil player <b>except Mordred</b> (Oberon is seen). Guide the table quietly: if the Assassin names you at the end, Evil wins.',
  percival: 'Sees Merlin and Morgana without knowing which is which. With no Morgana in the game, sees Merlin alone.',
  servant: 'Sees nothing. Watch the votes and the quests.',
  assassin: 'Evil. If three quests succeed, gets one strike at the end: name Merlin and the Minions of Mordred win. Sees the other Evil players (not Oberon).',
  morgana: 'Evil. Appears as Merlin to Percival. Sees the other Evil players (not Oberon).',
  mordred: 'Evil. Merlin cannot see Mordred. Sees the other Evil players (not Oberon).',
  oberon: 'Evil, but alone: sees no one, and no other Evil player sees Oberon. Merlin does see Oberon.',
  minion: 'Evil. Sees the other Evil players (not Oberon). Sabotage when it counts.',
};
const ORDER = ['merlin', 'percival', 'servant', 'assassin', 'morgana', 'mordred', 'oberon', 'minion'];
const roleItem = (id) => [ROLES[id].name, `<p>${ROLE_FAQ[id]}</p>`];
const rolesOf = (side) => ORDER.filter((id) => ROLES[id]?.side === side).map(roleItem);

// Every game setting the FAQ explains, for the drift test. House rules and modes come from the game's own tables.
export const FAQ_COVERS = {
  roles: ORDER,
  settings: ['merlin', 'percival', 'morgana', 'mordred', 'oberon'],
  house: ['lantern', 'anonVotes', 'noClaims', 'sitOut', 'turnTimer', 'revealDelay', 'firstLeader'],
  modes: ['phone', 'hybrid', 'physical'],
};
export const FAQ_GAME = { roles: Object.keys(ROLES), settings: OPTIONAL, house: Object.keys({ ...COMMON_HOUSE, ...HOUSE_DEFAULTS }), modes: ['phone', 'hybrid', ...Object.keys(MODE_PRESETS).filter((k) => k !== 'phone')] };

export const FAQ = [
  ['How to play', [
    ['What happens on a tied vote?', `<p>A tie is a rejection. A party goes only on a <b>strict majority</b> of everyone at the table (${MAJORITY_TEXT}).</p>`],
    [`What happens after ${WORD[MAX_REJECTS]} rejected parties?`, `<p>${WORD[MAX_REJECTS][0].toUpperCase() + WORD[MAX_REJECTS].slice(1)} rejected parties <b>in a row on the same quest</b> and the Minions of Mordred win at once. The count resets after every quest that goes out, whatever its result. The last allowed party is marked on the board and in the Host script.</p>`],
    ['Can the leader put themselves on the party?', '<p>Yes. The leader picks any players, including themselves.</p>'],
    ['When does quest 4 need two sabotage cards?', `<p>At ${TWO_FAIL_FROM} or more players. Everywhere else one sabotage card fails the quest. The board shows a small “2” on that quest.</p>`],
    ['Can a Loyal player play Sabotage?', '<p>No. With roles in the app, Loyal Servants can only play Success. Their Sabotage button looks the same as everyone’s, and pressing it quietly plays Success, so nobody watching can tell. With real role cards the app can’t know your side, so it’s on your honour, exactly as with the boxed game.</p>'],
    ['Who goes first and which way does the crown move?', '<p>The first leader is random (or the Host, as a house rule). The crown then moves one seat along the seat order after every vote that fails and every quest. The Host sets the seat order in the lobby to match the real table.</p>'],
    ['When does the Assassin strike?', `<p>Only if Merlin is in play and ${WORD[QUESTS_TO_WIN]} quests succeed. Each Evil player’s phone shows the teammates their card already knew (Oberon stays hidden), Evil may talk it over out loud, and the Assassin names one player. If it’s Merlin, the Minions of Mordred win; otherwise the Loyal Servants of Arthur win.</p>`],
  ]],
  ['Setup', [
    ['Which house rules are there?', '<ul><li><b>The Lantern</b>: the official optional loyalty check.</li><li><b>Anonymous votes</b>: only the count is shown.</li><li><b>No-claims mode</b>: no claim posts in the chat.</li><li><b>Host sits out</b>: the Host gets no card and sees the whole deal.</li><li><b>Phase timer</b>: a countdown per phase. At zero nothing happens automatically; the Host can nudge or skip.</li><li><b>Vote reveal delay</b>: a 3 or 5 second drumroll.</li><li><b>First leader</b>: random or the host.</li></ul><p>All are off by default, so the default game is the classic one.</p>'],
    ['Custom role mixes?', `<p>${MIN_PLAYERS} to ${MAX_PLAYERS} players. The Host turns the special cards on and off. The app checks there are enough Evil seats (${EVIL_TEXT}) and shows balance tips. Percival needs Merlin.</p>`],
  ]],
  ['Roles: Loyal Side', [
    ...rolesOf('good'),
  ]],
  ['Roles: Evil Side', [
    ...rolesOf('evil'),
    ['What is Evil’s shared knowledge?', '<ul><li>All Evil players see each other, <b>except Oberon</b>.</li><li>Evil never gets a secret chat. Everything is said at the table.</li></ul>'],
  ]],
  ['House Rule: The Lantern', [
    ['The Lantern', '<ol><li>An optional rule (the classic loyalty token).</li><li>The player to the right of the first leader starts with it.</li><li>After quests 2, 3 and 4 (if the game is still on), the holder picks someone who has never held it and learns their side, Loyal or Evil, not their role.</li><li>The Lantern then passes to that player.</li></ol><p class="muted">The holder may say anything about what they saw, true or not.</p>'],
  ]],
  ['Phones Mode', [
    ['What are the three ways to play?', '<ul><li><b>Phones Mode</b>: every player uses their own phone. Your card and who you see stay blurred until you hold the card. Works over a video call too.</li><li><b>Hybrid</b>: choose, piece by piece, whether role cards, votes and quest cards are real cards or in the app. The app always runs the board, the crown, the log, timers and the Host script.</li><li><b>Host-Only Mode</b>: real cards on the table, and just the Host’s phone as the board and tracker. Add players without phones as seats.</li></ul>'],
    ['Can I play with a normal deck of cards?', '<p>Yes. Red cards are Loyal and black cards are Evil: K♥ Merlin, Q♥ Percival, other red faces Loyal Servants of Arthur, K♠ Assassin, Q♠ Morgana, J♠ Mordred, K♣ Oberon, other black faces Minion of Mordred. Votes: hearts approve, spades reject. Quest cards: diamonds success, clubs sabotage. The lobby lists the exact cards for your table, and <a href="/print.html" target="_blank" rel="noopener">the printable card guide</a> has every table size and the eyes-closed script.</p>'],
    ['Does the Host see secrets in hybrid mode?', '<p>No. The Host only enters things the whole table sees anyway (who approved, how many sabotage cards were turned up, who the Assassin named). The table screen never shows anything secret. Only a Host who sits out, with roles in the app, sees the deal.</p>'],
    ['Printable cards?', '<p>Yes: <a href="/print.html" target="_blank" rel="noopener">The printable card guide</a> has a card guide and a sheet of Quest Night cards (original art) to print and cut.</p>'],
  ]],
  ['Playing Offline', [
    ['Can I play without internet?', '<ol><li>Open Quest Night once while you’re online, or install it: on iPhone tap Share, then Add to Home Screen; on Android tap Install app.</li><li>After that it opens without internet, so you can read the rules and this FAQ.</li><li>Playing a game needs internet for now, because every phone connects to the room. There is no offline mode yet.</li></ol><p>On iPhone, the Home Screen app and Safari keep separate copies, so open the one you’ll use while you’re online.<span hidden> wifi Wi-Fi</span></p>'],
  ]],
  ['Host Tools', [
    ['What can the Host do?', '<h4>Game flow</h4><ul><li>Pause and resume</li><li>Undo and Redo, back as far as the deal <span class="muted">· every phone is told; from the end screen it asks first, and the roles are hidden again</span></li><li>Skip an idle player <span class="muted">· a skipped vote counts as reject, a skipped quest card is Success, a skipped leader passes the crown, and a skipped Assassin strikes a random player (with role cards at the table, no strike is made and the Loyal side wins)</span></li><li>Skip the Lantern</li></ul><h4>Players</h4><ul><li>Nudge a phone</li><li>Pass the crown</li><li>Open a seat <span class="muted">· so someone else can take over a player</span></li><li>Hand off hosting</li></ul><h4>Chat &amp; table</h4><ul><li>Mute or remove chat messages</li><li>Read the narration script for each phase</li><li>Open the table screen</li></ul><h4>Closing</h4><ul><li>End game <span class="muted">· back to the lobby</span></li><li>Close room <span class="muted">· ends the table for everyone, deletes it and frees the code</span></li></ul>'],
    ['What are Table Tools?', '<p>Everyone can flip a coin, roll dice (1 to 6 dice, d6 or d20) or pick a random player. Those results are drawn by the server and written in the log, so nobody can fudge them. Private rolls stay on your phone. The Host also has shared timers, talk turns that pass around the table, a show-of-hands tally with a random tiebreak, and score or round counters. Your screen stays awake while a timer runs.</p>'],
    ['What is the table screen?', '<p>A view for a TV or laptop everyone can see: the board, the round table, the log and the chat. It never shows a secret. Open it from the Host tab.</p>'],
  ]],
  ['Joining and Privacy', [
    ['Can the Host restart the game?', '<p>Yes. On the end screen the Host taps <b>Play again</b>, or during a game opens the Host tab and taps <b>Restart game</b>. Everyone stays seated and gets a fresh deal with the same setup, straight into the secret cards. The chat, log and quest results start over. <b>Change setup first</b> goes back to the lobby instead.</p>'],
    ['Where can I see which roles are in the game?', '<p>Tap the scroll button at the top of any screen: <b>Roles in this game</b> lists every role in play and how many of each. It never says who holds which.</p>'],
    ['How do I join or rejoin?', '<p>Enter the 6-letter code or open the invite link. Your phone remembers your seat, so if it locks or drops off, open the link again and you’re back with the same card. If you lost your phone, the Host can open your seat and you join again with any name.</p>'],
    ['Is there secret team chat?', '<p>No. In the original game Evil never talks in secret during play, so the chat is public to the whole table. Claims go into the claims log so the table can check them later.</p>'],
    ['What happens when the Host closes the room?', '<ul><li>Every player sees “The host ended the game” with a link home.</li><li>The room and its code are deleted.</li><li>Saved “Back to table” shortcuts disappear. You can also remove one yourself with its ×.</li><li>Rooms that nobody touches expire by themselves after 12 hours.</li></ul>'],
    ['Do I need an account? What is stored?', '<p>No account, no email. Your name, the game and the chat live in the room on the server and are deleted 12 hours after the last move, or at once when the Host closes the room. Your phone keeps only your seat key and name in its own storage.</p>'],
  ]],
];
