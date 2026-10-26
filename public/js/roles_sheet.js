// "Roles in this game": a static explanation of the setup, the same for every viewer in every phase.
// Built from ROLES + roleList(). No names, no ids, nothing about who holds what or what has happened.
import { ROLES, SIDES, roleList, cleanSettings, MIN_PLAYERS, MAX_PLAYERS } from './rules.js';

const TITLES = { good: 'Loyal', evil: 'Evil' };
const ORDER = ['merlin', 'percival', 'servant', 'assassin', 'morgana', 'mordred', 'oberon', 'minion'];

// players: the seat count (in the lobby this is the planned table, clamped to 5-10 so the setup is always shown).
export function rolesInGame(players, settings) {
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Number.isInteger(players) ? players : MIN_PLAYERS));
  const s = cleanSettings(settings);
  const list = roleList(n, s);
  if (list.error) return { seats: n, error: list.error, groups: [] };
  const counts = new Map();
  for (const id of list.roles) counts.set(id, (counts.get(id) || 0) + 1);
  const note = (id) => {
    if (id === 'percival') return s.morgana ? 'Percival sees two players, Merlin and Morgana, and cannot tell which is which.' : 'Percival sees Merlin.';
    if (id === 'morgana') return 'Percival sees Morgana as a second Merlin.';
    return '';
  };
  const groups = ['good', 'evil'].map((side) => ({
    side, title: TITLES[side], name: SIDES[side].name,
    count: [...counts].filter(([id]) => ROLES[id].side === side).reduce((a, [, c]) => a + c, 0),
    roles: ORDER.filter((id) => counts.has(id) && ROLES[id].side === side)
      .map((id) => ({ id, name: ROLES[id].name, count: counts.get(id), icon: ROLES[id].icon, blurb: ROLES[id].blurb, note: note(id) })),
  }));
  return { seats: n, groups };
}

// The seat count the sheet describes: the dealt game, or the seated players in the lobby.
export const rolesSeats = (v) => v.game?.n || v.players.filter((p) => !p.watch).length;

export function rolesSheetBody(info, esc, glyph) {
  if (info.error) return `<p class="note is-warn">${esc(info.error)}</p>`;
  return info.groups.map((g) => `<section class="rs-group a-${g.side}" data-side="${g.side}"><h3 class="rs-side">${esc(g.title)} <small>${g.count}</small></h3><ul class="rs-list">${g.roles.map((r) => `<li class="rs-row" data-role="${r.id}"><span class="rs-ico">${glyph(r.icon)}</span><span class="rs-main"><b>${esc(r.name)}${r.count > 1 ? ` <span class="rs-n">×${r.count}</span>` : ''}</b><span class="rs-blurb">${esc(r.blurb)}</span>${r.note ? `<span class="rs-note">${esc(r.note)}</span>` : ''}</span></li>`).join('')}</ul></section>`).join('');
}
