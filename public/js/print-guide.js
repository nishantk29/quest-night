// The card guide's words and card plan, with no DOM. print.js renders these; test/print-guide.test.js checks them
// against rules.js, cards.js and the app's own mode names and opening script, so the paper and the app agree.
import { ROLES, QUEST_SIZES, EVIL_COUNT, failsNeeded } from './rules.js';
import { ROLE_CARD } from './cards.js';

// The three ways to play, in the same order and with the same names as the lobby (app.js MODES).
export const MODES = [
  { id: 'phone', name: 'Phones Mode', cards: 'None.',
    how: 'Every player uses their phone for their role, votes and quest cards. Works for online play too.' },
  { id: 'hybrid', name: 'Hybrid', cards: 'Only the pieces you set to Physical.',
    how: 'Choose each piece on its own: secret cards, approve / reject votes, success / sabotage cards. Each one is In the app or Physical.' },
  { id: 'physical', name: 'Host-Only Mode', cards: 'Real cards for every piece.',
    how: 'Real cards on the table. The Host’s phone is the board, the tracker and the Host script. Players without phones can sit as seats.' },
];

// The app always runs the board, the log, the timers and the Host script, in every mode.
export const MODE_NOTE = 'The app always runs the board, the crown, the log, the timers and the Host script.';

// The cards for everything that is not a role. Ranks run A, 2 to 10; faces are J, Q, K.
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
const run = (suit, from, to) => RANKS.slice(from - 1, to).map((r) => suit + r);
export const KEY = [
  { piece: 'Votes', cards: 'Approve: ♥A–10, one per player. Reject: ♠A–10, one per player.', pool: [...run('♥', 1, 10), ...run('♠', 1, 10)] },
  { piece: 'Quest cards', cards: 'Success: ♦A–5. Sabotage: ♣A–5. One of each per party member.', pool: [...run('♦', 1, 5), ...run('♣', 1, 5)] },
  { piece: 'The crown', cards: '♣10. Passes left after every failed vote and every quest.', pool: ['♣10'] },
  { piece: 'The Lantern (optional)', cards: 'Black joker. Loyalty cards: Loyal ♦6–10 and the red joker, Evil ♣6–9. Each player gets the loyalty card that matches the colour of their role card.',
    pool: [...run('♦', 6, 10), '♣6', '♣7', '♣8', '♣9', 'black joker', 'red joker'] },
];

// Role cards in the order the guide lists them. `cards` comes from cards.js (ROLE_CARD), so they can't drift.
// `sees` is the app's own rule (FAQ, "What each role sees").
export const ROLE_ROWS = [
  { role: 'merlin', sees: 'Every Evil player except Mordred. Oberon is seen.' },
  { role: 'percival', sees: 'Merlin and Morgana, without knowing which is which. Without Morgana, Merlin alone.' },
  { role: 'servant', sees: 'Nothing. Watch the votes and the quests.', more: ' Any other red face card.' },
  { role: 'morgana', sees: 'The other Evil players, except Oberon. To Percival, looks like Merlin.' },
  { role: 'mordred', sees: 'The other Evil players, except Oberon. Hidden from Merlin.' },
  { role: 'oberon', sees: 'Nobody. Nobody sees Oberon, and Oberon knows no one.' },
  { role: 'assassin', sees: 'The other Evil players, except Oberon. If Merlin is in play and three quests succeed, one last strike at a Loyal player.' },
  { role: 'minion', sees: 'The other Evil players, except Oberon.', more: ' Any other black face card.' },
].map((row) => ({ ...row, name: ROLES[row.role].name, side: ROLES[row.role].side === 'good' ? 'Loyal' : 'Evil', cards: ROLE_CARD[row.role] }));

// Party sizes and the vote and card counts for each table size (5 to 10 players), from rules.js.
export function tableRows() {
  return [5, 6, 7, 8, 9, 10].map((n) => ({
    n,
    loyal: n - EVIL_COUNT[n],
    evil: EVIL_COUNT[n],
    sizes: QUEST_SIZES[n].map((size, i) => ({ size, twoFails: failsNeeded(n, i) === 2 })),
  }));
}

// The role cards to pull for a table, the recommended mix from cards.js (Merlin and the Assassin always in).
export const RECOMMENDED_NOTE = 'Merlin and the Assassin are always in. From 7 players, add Percival and Morgana; from 9, Mordred; at 10, Oberon. With only Merlin on, the app’s default, pull the same cards for Merlin and the Loyal Servants, and the Minions for the rest.';

// The eyes-closed opening script, line for line the app’s own (app.js openingScript). `roles` is the role ids on the table.
export function openingScript(roles) {
  const has = (r) => roles.includes(r);
  const lines = ['Everyone, close your eyes and put your hand in a fist on the table.',
    `Evil${has('oberon') ? ', except Oberon,' : ''} open your eyes and look around. These are your allies.`,
    '(Pause.) Evil, close your eyes.'];
  if (has('merlin')) lines.push(`Evil${has('mordred') ? ', except Mordred,' : ''} raise your thumb.`,
    'Merlin, open your eyes. These players serve Evil.', '(Pause.) Merlin, close your eyes. Evil, lower your thumbs.');
  if (has('percival')) lines.push(`Merlin${has('morgana') ? ' and Morgana' : ''}, raise your thumb.`,
    `Percival, open your eyes. ${has('morgana') ? 'One of these is Merlin.' : 'This is Merlin.'}`, '(Pause.) Percival, close your eyes. Thumbs down.');
  lines.push('Everyone, open your eyes.');
  return lines;
}
