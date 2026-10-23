// The printable card guide (standard 52-card deck) and the Quest Night card sheet, both built from the same
// data the app uses (rules.js, cards.js, print-guide.js), so the paper and the app can never disagree.
import { ROLES } from './rules.js';
import { roleCards, RECOMMENDED } from './cards.js';
import { MODES, MODE_NOTE, KEY, ROLE_ROWS, tableRows, RECOMMENDED_NOTE, openingScript } from './print-guide.js';
import { glyph } from './glyphs.js';
import { art } from './art.js';

const part = new URLSearchParams(location.search).get('part');
// Suits in colour: hearts and diamonds red, spades and clubs black.
const suits = (s) => s.replace(/[♥♦]\w*/g, (m) => `<span class="red">${m}</span>`).replace(/[♣♠]\w*/g, (m) => `<span class="blk">${m}</span>`);
const red = (c) => `<span class="${/[♥♦]/.test(c) ? 'red' : 'blk'}">${c}</span>`;
const L = (id) => ROLES[id].name;

// Each table size's role cards, in the order the app deals them (recommended mix, see RECOMMENDED_NOTE).
const cardsFor = (n) => {
  const r = roleCards(n, RECOMMENDED(n));
  const side = (s) => r.cards.filter((c) => ROLES[c.role].side === s).map((c) => `${red(c.card)} ${L(c.role)}`).join('<br>');
  return { loyal: side('good'), evil: side('evil') };
};

function guide() {
  const modes = MODES.map((m) => `<tr><td data-label="Mode"><b>${m.name}</b></td><td data-label="Cards">${m.cards}</td><td data-label="How it works">${m.how}</td></tr>`).join('');
  const key = KEY.map((k) => `<tr><td data-label="Piece">${k.piece}</td><td data-label="Cards">${suits(k.cards)}</td></tr>`).join('');
  const roles = ROLE_ROWS.map((r) => `<tr><td data-label="Role"><b>${r.name}</b></td><td data-label="Card">${suits(r.cards)}${r.more || ''}</td><td data-label="Side">${r.side}</td><td data-label="Sees">${r.sees}</td></tr>`).join('');
  const rows = tableRows().map((t) => {
    const c = cardsFor(t.n);
    return `<tr><td data-label="Players"><b>${t.n}</b></td><td data-label="Loyal cards">${c.loyal}</td><td data-label="Evil cards">${c.evil}</td>
      <td data-label="Votes">${suits(`♥A–${t.n}`)} and ${suits(`♠A–${t.n}`)}</td><td data-label="Party sizes">${t.sizes.map((s) => `${s.size}${s.twoFails ? '*' : ''}`).join(' · ')}</td></tr>`;
  }).join('');
  const script = openingScript(['merlin', 'percival', 'morgana', 'mordred', 'oberon']).map((l) => `<li>${l}</li>`).join('');
  return `<section class="sheet"><h1>Quest Night</h1>
  <p class="lede"><b>Card guide.</b> Play with phones only, with real cards, or with both. Start by choosing a mode.</p>
  <h2>Choose a mode</h2>
  <table><tr><th>Mode</th><th>Cards</th><th>How it works</th></tr>${modes}</table>
  <p><b>Phones Mode needs no cards.</b> Skip to the Host section, or open Quest Night on every phone and start.</p>
  <p class="note">${MODE_NOTE}</p>
  <h2>The Host</h2>
  <ul>
    <li>The Host opens the table on their phone and sets the mode, the special roles and the seat order to match the real table.</li>
    <li>The Host plays too and gets a card. The house rule Host sits out is off by default. When it is on, the Host gets no card and sees the whole deal.</li>
    <li>In Hybrid and Host-Only Mode, the Host enters only what the whole table already sees: votes, sabotage cards played and the Assassin’s pick.</li>
    <li>The Host reads the opening script below, then each phase script on the Host tab.</li>
  </ul>
  <h2>The key</h2>
  <table><tr><th>Piece</th><th>Cards</th></tr>
    <tr><td data-label="Piece">Role cards</td><td data-label="Cards"><b>Red = Loyal, black = Evil.</b> The face cards carry the roles, see below.</td></tr>
    ${key}</table>
  <h2>Role cards</h2>
  <table><tr><th>Role</th><th>Card</th><th>Side</th><th>Sees</th></tr>${roles}</table>
  <h2>Party sizes and cards by table size</h2>
  <table><tr><th>Players</th><th>Loyal cards</th><th>Evil cards</th><th>Votes</th><th>Party sizes, quests 1–5</th></tr>${rows}</table>
  <p class="note">* Quest 4 at 7 or more players needs two sabotage cards to fail. Five rejected parties in a row on one quest and the Minions of Mordred win.</p>
  <p class="note">${RECOMMENDED_NOTE} The app’s lobby lists the exact cards for any mix.</p>
  <h2>Setup</h2><p>For Hybrid and Host-Only Mode, set up the pieces you set to Physical.</p><ol>
  <li>If the role cards are physical, pull them for your table (see the table above). Shuffle them face down and deal one to each player. Look at your own card in secret.</li>
  <li>If the votes are physical, give each player one approve card and one reject card. If the quest cards are physical, put them near the table.</li>
  <li>Choose the first leader at random (the app’s coin or picker works). The crown passes left after every failed vote and every quest.</li>
  <li>Read the opening script below, then play: the leader names a party, everyone votes at once, each party member plays one quest card face down (Loyal Servants must play success), and the leader shuffles and turns them over. The Host enters the result in the app.</li></ol>
  <h2>Opening script (eyes closed, read aloud by the Host)</h2><ol class="script">${script}</ol>
  <p class="note">Leave out the lines about roles that are not in your game, and “except Oberon” or “except Mordred” when that role is out. Quest Night is an original game in the hidden-minion quest family; names, wording and art are its own.</p></section>`;
}

const card = (cls, icon, name, side, blurb) => `<div class="c ${cls}"><div class="ci">${cls === 'good' || cls === 'evil' ? art(cls, 'crest') : ''}<span class="side">${side}</span>${icon}<b>${name}</b><small>${blurb || ''}</small></div></div>`;
function cardsSheet() {
  const roles = [['merlin', 1], ['percival', 1], ['servant', 4], ['assassin', 1], ['morgana', 1], ['mordred', 1], ['oberon', 1], ['minion', 3]];
  const out = [];
  for (const [id, k] of roles) for (let i = 0; i < k; i++) { const r = ROLES[id]; out.push(card(r.side, glyph(r.icon), r.name, r.side === 'good' ? 'LOYAL SERVANTS' : 'MINIONS OF MORDRED', r.blurb)); }
  for (let i = 0; i < 10; i++) out.push(card('good', art('approve'), 'Approve', 'VOTE', 'Send this party.'));
  for (let i = 0; i < 10; i++) out.push(card('evil', art('reject'), 'Reject', 'VOTE', 'Not this party.'));
  for (let i = 0; i < 5; i++) out.push(card('good', art('chalice'), 'Success', 'QUEST', 'Every Loyal servant plays this.'));
  for (let i = 0; i < 5; i++) out.push(card('evil', art('broken'), 'Sabotage', 'QUEST', 'Only Evil may play this.'));
  for (let i = 0; i < 6; i++) out.push(card('good', art('good'), 'Loyal', 'LOYALTY', 'Shown only to the Lantern.'));
  for (let i = 0; i < 4; i++) out.push(card('evil', art('evil'), 'Evil', 'LOYALTY', 'Shown only to the Lantern.'));
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
