// Playing-card mapping for Quest Night: how to run the game with one standard 52-card deck plus jokers.
// Shared by the lobby, the FAQ and the printable guide (print.html), so they can never disagree.
import { roleList, ROLES, QUEST_SIZES, EVIL_COUNT } from './rules.js';

// Role cards: the colour is the side (red Loyal, black Evil), face cards carry the roles.
const GOOD_CARDS = { merlin: ['K♥'], percival: ['Q♥'], servant: ['J♥', 'K♦', 'Q♦', 'J♦', 'Q♥', 'K♥'] };
const EVIL_CARDS = { assassin: ['K♠'], morgana: ['Q♠'], mordred: ['J♠'], oberon: ['K♣'], minion: ['Q♣', 'J♣', 'K♣', 'J♠', 'Q♠'] };
export const ROLE_CARD = { merlin: 'K♥', percival: 'Q♥', servant: 'J♥ / K♦ / Q♦ / J♦', assassin: 'K♠', morgana: 'Q♠', mordred: 'J♠', oberon: 'K♣', minion: 'Q♣ / J♣' };

export const PIECES = {
  approve: 'Approve: hearts A to 10 (one per player)',
  reject: 'Reject: spades A to 10 (one per player)',
  success: 'Success: diamonds A to 5 (one per party member)',
  sabotage: 'Sabotage: clubs A to 5 (one per party member)',
  loyalty: 'Lantern loyalty cards: Loyal ♦6 to ♦10 and the red joker, Evil ♣6 to ♣9',
  lantern: 'The Lantern: the black joker',
  crown: 'The crown (leader): the ♣10, passed left',
};

// The exact role cards to pull for a table, in deal order (shuffle them before dealing).
export function roleCards(n, settings) {
  const list = roleList(n, settings);
  if (list.error) return { error: list.error };
  const used = new Set(); const out = [];
  for (const r of list.roles) {
    const pool = ROLES[r].side === 'good' ? GOOD_CARDS[r] : EVIL_CARDS[r];
    const card = pool.find((c) => !used.has(c)) || (ROLES[r].side === 'good' ? GOOD_CARDS.servant : EVIL_CARDS.minion).find((c) => !used.has(c));
    used.add(card); out.push({ card, role: r });
  }
  return { cards: out, sizes: QUEST_SIZES[n], evil: EVIL_COUNT[n] };
}
export const RECOMMENDED = (n) => (n >= 7 ? { merlin: true, percival: true, morgana: true, mordred: n >= 9, oberon: n === 10 } : { merlin: true, percival: false, morgana: false, mordred: false, oberon: false });
