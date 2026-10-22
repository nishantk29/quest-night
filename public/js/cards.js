// Playing-card mapping for Quest Night: how to run the game with one standard 52-card deck plus jokers.
// Shared by the lobby, the FAQ and the printable guide (print.html), so they can never disagree.
import { roleList, ROLES, QUEST_SIZES, SHADOW_COUNT } from './rules.js';

// Role cards: the colour is the side (red Loyal, black Shadow), face cards carry the roles.
const LOYAL_CARDS = { seer: ['K♥'], herald: ['Q♥'], knight: ['J♥', 'K♦', 'Q♦', 'J♦', 'Q♥', 'K♥'] };
const SHADOW_CARDS = { assassin: ['K♠'], enchantress: ['Q♠'], usurper: ['J♠'], outcast: ['K♣'], traitor: ['Q♣', 'J♣', 'K♣', 'J♠', 'Q♠'] };
export const ROLE_CARD = { seer: 'K♥', herald: 'Q♥', knight: 'J♥ / K♦ / Q♦ / J♦', assassin: 'K♠', enchantress: 'Q♠', usurper: 'J♠', outcast: 'K♣', traitor: 'Q♣ / J♣' };

export const PIECES = {
  approve: 'Approve: hearts A to 10 (one per player)',
  reject: 'Reject: spades A to 10 (one per player)',
  success: 'Success: diamonds A to 5 (one per party member)',
  sabotage: 'Sabotage: clubs A to 5 (one per party member)',
  loyalty: 'Lantern loyalty cards: Loyal ♦6 to ♦10 and the red joker, Shadow ♣6 to ♣9',
  lantern: 'The Lantern: the black joker',
  crown: 'The crown (leader): the ♣10, passed left',
};

// The exact role cards to pull for a table, in deal order (shuffle them before dealing).
export function roleCards(n, settings) {
  const list = roleList(n, settings);
  if (list.error) return { error: list.error };
  const used = new Set(); const out = [];
  for (const r of list.roles) {
    const pool = ROLES[r].side === 'loyal' ? LOYAL_CARDS[r] : SHADOW_CARDS[r];
    const card = pool.find((c) => !used.has(c)) || (ROLES[r].side === 'loyal' ? LOYAL_CARDS.knight : SHADOW_CARDS.traitor).find((c) => !used.has(c));
    used.add(card); out.push({ card, role: r });
  }
  return { cards: out, sizes: QUEST_SIZES[n], shadow: SHADOW_COUNT[n] };
}
export const RECOMMENDED = (n) => (n >= 7 ? { seer: true, herald: true, enchantress: true, usurper: n >= 9, outcast: n === 10 } : { seer: true, herald: false, enchantress: false, usurper: false, outcast: false });
