// Quest Night FAQ: short answers that match the rules exactly as this app runs them.
export const FAQ = [
  ['How to Play', [
    ['What happens on a tied vote?', '<p>A tie is a rejection. A party goes only on a <b>strict majority</b> of everyone at the table (3 of 5, 4 of 6 or 7, 5 of 8 or 9, 6 of 10).</p>'],
    ['What happens after five rejected parties?', '<p>Five rejected parties <b>in a row on the same quest</b> and the Minions of Mordred win at once. The count resets after every quest that goes out, whatever its result. The fifth party is marked on the board and in the Host script.</p>'],
    ['Can the leader put themselves on the party?', '<p>Yes. The leader picks any players, including themselves.</p>'],
    ['When does quest 4 need two sabotage cards?', '<p>At 7 or more players. Everywhere else one sabotage card fails the quest. The board shows a small “2” on that quest.</p>'],
    ['Can a Loyal player play Sabotage?', '<p>No. With roles in the app, Loyal Servants can only play Success. Their Sabotage button looks the same as everyone’s, and pressing it quietly plays Success, so nobody watching can tell. With real role cards the app can’t know your side, so it’s on your honour, exactly as with the boxed game.</p>'],
    ['Who goes first and which way does the crown move?', '<p>The first leader is random (or the Host, as a house rule). The crown then moves one seat along the seat order after every vote that fails and every quest. The Host sets the seat order in the lobby to match the real table.</p>'],
    ['When does the Assassin strike?', '<p>Only if Merlin is in play and three quests succeed. Evil is revealed, they may talk, and the Assassin names one Loyal player. If it’s Merlin, the Minions of Mordred win; otherwise the Loyal Servants of Arthur win.</p>'],
  ]],
  ['Setup', [
    ['Which house rules are there?', '<ul><li><b>The Lantern</b>: the official optional loyalty check.</li><li><b>Anonymous votes</b>: only the count is shown.</li><li><b>No-claims mode</b>: no claim posts in the chat.</li><li><b>Host sits out</b>: the Host gets no card and sees the whole deal.</li><li><b>Phase timer</b>: a countdown per phase. At zero nothing happens automatically; the Host can nudge or skip.</li><li><b>Vote reveal delay</b>: a 3 or 5 second drumroll.</li><li><b>First leader</b>: random or the host.</li></ul><p>All are off by default, so the default game is the classic one.</p>'],
    ['Custom role mixes?', '<p>The Host turns the special cards on and off. The app checks there are enough Evil seats (2 at 5–6, 3 at 7–9, 4 at 10) and shows balance tips.</p>'],
  ]],
  ['Roles', [
    ['Merlin', '<p>Sees every Evil player <b>except Mordred</b>. Oberon is seen.</p>'],
    ['Percival', '<p>Sees Merlin and Morgana, without knowing which is which. Without Morgana, sees Merlin alone.</p>'],
    ['Evil', '<p>All Evil players see each other, <b>except Oberon</b>, who sees nobody and whom nobody sees.</p>'],
    ['Loyal Servant of Arthur', '<p>Sees nothing. Watch the votes and the quests.</p>'],
    ['The Lantern', '<p>An optional rule (the classic loyalty token). The player to the right of the first leader starts with it. After quests 2, 3 and 4 (if the game is still on), the holder chooses someone who has never held it and learns their side, Loyal or Evil, not their role. The Lantern then passes to that player. The holder may say anything about what they saw, true or not.</p>'],
  ]],
  ['Phones Mode', [
    ['What are the three ways to play?', '<ul><li><b>Phones Mode</b>: every player uses their own phone. Your card and who you see stay blurred until you hold the card. Works over a video call too.</li><li><b>Hybrid</b>: choose, piece by piece, whether role cards, votes and quest cards are real cards or in the app. The app always runs the board, the crown, the log, timers and the Host script.</li><li><b>Host-Only Mode</b>: real cards on the table, and just the Host’s phone as the board and tracker. Add players without phones as seats.</li></ul>'],
    ['Can I play with a normal deck of cards?', '<p>Yes. Red cards are Loyal and black cards are Evil: K♥ Merlin, Q♥ Percival, other red faces Loyal Servants of Arthur, K♠ Assassin, Q♠ Morgana, J♠ Mordred, K♣ Oberon, other black faces Minion of Mordred. Votes: hearts approve, spades reject. Quest cards: diamonds success, clubs sabotage. The lobby lists the exact cards for your table, and <a href="/print.html" target="_blank" rel="noopener">the printable guide</a> has every table size and the eyes-closed script.</p>'],
    ['Does the Host see secrets in hybrid mode?', '<p>No. The Host only enters things the whole table sees anyway (who approved, how many sabotage cards were turned up, who the Assassin named). The table screen never shows anything secret. Only a Host who sits out, with roles in the app, sees the deal.</p>'],
    ['Printable cards?', '<p>Yes: <a href="/print.html" target="_blank" rel="noopener">print.html</a> has a card guide and a sheet of Quest Night cards (original art) to print and cut.</p>'],
  ]],
  ['Playing Offline', [
    ['Can I play without internet?', '<ol><li>Open Quest Night once while you’re online, or install it: on iPhone tap Share, then Add to Home Screen; on Android tap Install app.</li><li>After that it opens without internet, so you can read the rules and this FAQ.</li><li>Playing a game needs internet for now, because every phone connects to the room. There is no offline mode yet.</li></ol><p>On iPhone, the Home Screen app and Safari keep separate copies, so open the one you’ll use while you’re online.<span hidden> wifi Wi-Fi</span></p>'],
  ]],
  ['Host Tools', [
    ['What can the Host do?', '<p>From the Host tab: pause and resume, undo the last step, skip an idle player (a skipped vote counts as reject, a skipped quest card is Success), nudge a phone, pass the crown, skip the Lantern, open a seat so someone else can take over a player, hand off hosting, mute or remove chat messages, read the narration script for each phase, and open the table screen. Every skip and undo is written in the log.</p>'],
    ['What are Table Tools?', '<p>Everyone can flip a coin, roll dice (1 to 6 dice, d6 or d20) or pick a random player. Those results are drawn by the server and written in the log, so nobody can fudge them. Private rolls stay on your phone. The Host also has shared timers, talk turns that pass around the table, a show-of-hands tally with a random tiebreak, and score or round counters. Your screen stays awake while a timer runs.</p>'],
    ['What is the table screen?', '<p>A view for a TV or laptop everyone can see: the board, the round table, the log and the chat. It never shows a secret. Open it from the Host tab.</p>'],
  ]],
  ['Joining and Privacy', [
    ['How do I join or rejoin?', '<p>Enter the 6-letter code or open the invite link. Your phone remembers your seat, so if it locks or drops off, open the link again and you’re back with the same card. If you lost your phone, the Host can open your seat and you join again with any name.</p>'],
    ['Is there secret team chat?', '<p>No. In the original game Evil never talks in secret during play, so the chat is public to the whole table. Claims go into the claims log so the table can check them later.</p>'],
    ['Do I need an account? What is stored?', '<p>No account, no email. Your name, the game and the chat live in the room on the server and are deleted 12 hours after the last move. Your phone keeps only your seat key and name in its own storage.</p>'],
  ]],
];
