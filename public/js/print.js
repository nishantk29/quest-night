// The printable card guide (standard 52-card deck) and the Quest Night card sheet, both built from the same
// data the app uses (rules.js, cards.js), so the paper and the app can never disagree.
import { ROLES, QUEST_SIZES, SHADOW_COUNT, failsNeeded } from './rules.js';
import { roleCards, RECOMMENDED, ROLE_CARD, PIECES } from './cards.js';
import { glyph } from './glyphs.js';
import { art } from './art.js';

const part = new URLSearchParams(location.search).get('part');
const red = (c) => `<span class="${/[♥♦]/.test(c) ? 'red' : 'blk'}">${c}</span>`;
const L = (id) => ROLES[id].name;

function guide() {
  const rows = [5, 6, 7, 8, 9, 10].map((n) => {
    const r = roleCards(n, RECOMMENDED(n));
    const loyal = r.cards.filter((c) => ROLES[c.role].side === 'loyal'); const shadow = r.cards.filter((c) => ROLES[c.role].side === 'shadow');
    return `<tr><td><b>${n}</b></td><td>${loyal.map((c) => `${red(c.card)} ${L(c.role)}`).join('<br>')}</td><td>${shadow.map((c) => `${red(c.card)} ${L(c.role)}`).join('<br>')}</td>
      <td>♥A–♥${n === 10 ? '10' : n} approve<br>♠A–♠${n === 10 ? '10' : n} reject</td><td>${QUEST_SIZES[n].map((s, i) => `${s}${failsNeeded(n, i) === 2 ? '*' : ''}`).join(' · ')}</td></tr>`;
  }).join('');
  return `<section class="sheet"><h1>Quest Night</h1><p><b>Card guide: play with one regular deck of cards.</b> Use it with the app in “All physical” or “Hybrid” mode (the host’s phone keeps the board, the crown and the narration), or with no phone at all.</p>
  <h2>The key</h2>
  <table><tr><th>Piece</th><th>Cards</th></tr>
    <tr><td>Role cards</td><td><b>Red = Loyal, black = Shadow.</b> ${Object.entries(ROLE_CARD).map(([k, c]) => `${c.split(' / ').map(red).join(' / ')} ${L(k)}`).join(' · ')}</td></tr>
    <tr><td>Votes</td><td>${PIECES.approve}. ${PIECES.reject}.</td></tr>
    <tr><td>Quest cards</td><td>${PIECES.success}. ${PIECES.sabotage}.</td></tr>
    <tr><td>The crown</td><td>${PIECES.crown}.</td></tr>
    <tr><td>The Lantern (optional)</td><td>${PIECES.lantern}. ${PIECES.loyalty}. Deal each player a loyalty card matching the colour of their role card.</td></tr></table>
  <h2>What to pull for each table (classic setup)</h2>
  <table><tr><th>Players</th><th>Loyal cards</th><th>Shadow cards</th><th>Votes</th><th>Party sizes</th></tr>${rows}</table>
  <p class="note">* Quest 4 at 7 or more players needs two Sabotage cards to fail. Five rejected parties in a row on one quest and the Shadow wins. Turning on other special cards: swap a Loyal Knight for the Herald (Q♥), or a Traitor for the Enchantress (Q♠), Usurper (J♠) or Outcast (K♣). The app’s lobby lists the exact cards for any mix.</p>
  <h2>Setup</h2><ol><li>Pull the role cards for your table, shuffle them face down and deal one to each player. Look at your own card in secret.</li>
  <li>Give every player one approve card (a heart) and one reject card (a spade), and put the diamond and club quest cards near the table.</li>
  <li>Choose the first leader at random (the app’s coin or picker works) and give them the ♣10 as the crown. It passes left.</li>
  <li>Read the eyes-closed script below, then play: the leader names a party, everyone votes at once, the party plays one quest card each face down (Loyal must play a diamond), and the leader shuffles and turns them over.</li></ol>
  <h2>Eyes-closed script (read aloud)</h2><ol class="script">
   <li>Everyone, close your eyes and put your hand in a fist on the table.</li>
   <li>Shadow (black cards), except the Outcast, open your eyes and look around. These are your allies. … Shadow, close your eyes.</li>
   <li>Shadow, except the Usurper, raise your thumb. Seer, open your eyes and see who serves the Shadow. … Seer, close your eyes. Shadow, thumbs down.</li>
   <li>If the Herald is in play: Seer and Enchantress, raise your thumb. Herald, open your eyes: one of these is the Seer. … Herald, close your eyes. Thumbs down.</li>
   <li>Everyone, open your eyes.</li></ol>
  <p class="note">Leave out any line for a card that isn’t in the game. Quest Night is an original game in the hidden-traitor quest family; names, wording and art are its own.</p></section>`;
}

const card = (cls, icon, name, side, blurb) => `<div class="c ${cls}"><div class="ci">${cls === 'loyal' || cls === 'shadow' ? art(cls, 'crest') : ''}<span class="side">${side}</span>${icon}<b>${name}</b><small>${blurb || ''}</small></div></div>`;
function cardsSheet() {
  const roles = [['seer', 1], ['herald', 1], ['knight', 4], ['assassin', 1], ['enchantress', 1], ['usurper', 1], ['outcast', 1], ['traitor', 3]];
  const out = [];
  for (const [id, k] of roles) for (let i = 0; i < k; i++) { const r = ROLES[id]; out.push(card(r.side, glyph(r.icon), r.name, r.side === 'loyal' ? 'THE LOYAL' : 'THE SHADOW', r.blurb)); }
  for (let i = 0; i < 10; i++) out.push(card('loyal', art('approve'), 'Approve', 'VOTE', 'Send this party.'));
  for (let i = 0; i < 10; i++) out.push(card('shadow', art('reject'), 'Reject', 'VOTE', 'Not this party.'));
  for (let i = 0; i < 5; i++) out.push(card('loyal', art('chalice'), 'Success', 'QUEST', 'Every Loyal knight plays this.'));
  for (let i = 0; i < 5; i++) out.push(card('shadow', art('broken'), 'Sabotage', 'QUEST', 'Only the Shadow may play this.'));
  for (let i = 0; i < 6; i++) out.push(card('loyal', art('loyal'), 'Loyal', 'LOYALTY', 'Shown only to the Lantern.'));
  for (let i = 0; i < 4; i++) out.push(card('shadow', art('shadow'), 'Shadow', 'LOYALTY', 'Shown only to the Lantern.'));
  out.push(card('gold', art('lantern'), 'The Lantern', 'TOKEN', 'After quests 2, 3 and 4.'));
  out.push(card('gold', art('crown'), 'The Crown', 'LEADER', 'Passes left.'));
  out.push(card('gold', art('table'), 'Quest Night', 'REFERENCE', '5–10 players · three quests win'));
  const backs = Array.from({ length: 9 }, () => '<div class="c back gold"><div class="ci">' + art('crown') + '</div></div>').join('');
  const pages = [];
  for (let i = 0; i < out.length; i += 9) pages.push(`<section class="sheet cardpage break"><div class="cards">${out.slice(i, i + 9).join('')}</div></section>`);
  pages.push(`<section class="sheet cardpage break"><div class="cards">${backs}</div></section>`);
  pages.unshift(`<section class="sheet ${part !== 'cards' ? 'break' : ''}"><h2>Printable cards</h2><p>Print the next pages on card stock and cut on the dashed lines (63 × 88 mm, poker size). Print the last page (backs) as many times as you need and glue or print double-sided. ${out.length} cards: 13 role cards, 20 votes, 10 quest cards, 10 loyalty cards, the Lantern, the Crown and a reference card. All art is original to Quest Night.</p></section>`);
  return pages.join('');
}
document.getElementById('out').innerHTML = (part === 'cards' ? '' : guide()) + (part === 'guide' ? '' : cardsSheet());
document.title = part === 'cards' ? 'Quest Night: printable cards' : part === 'guide' ? 'Quest Night: card guide' : document.title;
