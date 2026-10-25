# Quest Night logic audit (rulesVersion 2)

## Scope
Engine and views: `public/js/rules.js`, `table.js`, `room.js`, `src/worker.js`, `src/fanout.js`, plus the render paths in
`app.js` that use role data, `print-guide.js` (eyes-closed script) and `roles_sheet.js`. Areas: role-by-role spec against the
FAQ and classic rules, pairwise role interactions, look-alike/duplicate roles, phases and timing, and leaks.

## Method
Read each area narrowly, wrote a test that fails on any bug, fixed it, kept the suite green. Behaviour that was already right is
pinned by a "confirmation" test so it cannot regress. Everything is in `test/audit-v2.test.js` (the many-games simulation is
Task D, the deploy gate Task E). Leak, display and crash fixes apply to every room; fixes that change a legal move are gated
`rulesVersion >= 2`. Rooms without `rulesVersion` are version 1 and never backfilled.

## Findings
| Area | Finding | Fix | rulesVersion | Test |
|---|---|---|---|---|
| Look-alikes | Percival's two candidates (and Merlin's / Evil's lists) were in seat order | per-game random `game.order` (never sent to a client); lists follow it, stable within the game | new games (games dealt earlier fall back to seat order) | `percival-order: ...`, `knowledge-order: ...`, `old-game-order: ...` |
| Leaks | At the strike, every Evil player (and Oberon) was sent the full Evil list, so Oberon was exposed to the team and Oberon saw everyone | list = what that role's card already knows; Oberon gets none | all | `assassin-phase-oberon: ...` |
| Leaks | Naming a non-Loyal player was refused with "choose a Loyal player", so the Assassin could probe sides (e.g. find Oberon) | the Assassin may name any other player; only self is refused | all | `strike-no-oracle: ...` |
| Phases | Assassin phase could not be skipped: an absent/opened-seat Assassin stalled the game | host Skip makes a random strike at a non-Assassin, logged in the open | 2 | `assassin-skip: ...` (3 tests) |
| Leaks | A host who rejoined as a late watcher and claimed the host key got the moderator view (the whole deal) | moderator view only when Host sits out is on | all | `moderator-view: ...` |
| Leaks | A seat the host opened (kick) kept its old socket: that phone kept receiving the card and could act | sockets carry their seat token; stale ones get a "seat opened" notice and are sent back to the join form (worker + fanout) | all | `kicked-socket: ...` |
| Confirmed | Good Sabotage counts as Success silently; 5th rejection and ties; quest 4 two-fail at 7+; no-Assassin win; Evil win at once; double votes/cards, non-team cards, wrong team sizes, actions after game over; Lantern timing/past holders/true side; undo across phases; pause; screen view and quest cards carry nothing private; reconnect view; skip with opened seats in every phase | no change needed | - | `good-never-sabotages`, `five-rejections`, `quest-four`, `no-assassin`, `evil-wins-at-once`, `vote-and-card-guards`, `wrong-size-team`, `lantern`, `undo-across-phases`, `pause`, `screen-view`, `quest-cards-private`, `reconnect`, `skip-every-phase` |

Also checked, no change: Merlin sees Evil except Mordred and does see Oberon; Percival with Morgana absent sees Merlin alone;
Mordred + Oberon together; the eyes-closed script and role sheet call roles as groups (never per-minion); reveal duration,
card markup and quest-card reveal (count-only, seeded shuffle) are identical whatever the hidden info.

## Not covered
- Hybrid/physical roles: the app cannot know sides, so a Loyal player's physical-cards Sabotage cannot be blocked and the
  Lantern shows nothing (the table does it with cards).
- Real WebSocket/Durable Object behaviour (only the pure fanout and reducer are tested); service worker; visual timing in a browser.
- Games already in progress when this ships keep seat-order knowledge lists (no `game.order` yet).

## Rule choices for Nishant
1. **Skipping an absent Assassin** strikes a random other player (Merlin only if hit), logged openly. Alternative: Good wins by
   default. Default chosen so a no-show neither hands Evil a free win nor Good one.
2. **Host Skip on the leader's turn** passes the crown without counting as a rejection (kept as it was).
3. **Percival without Morgana** sees Merlin alone, shown as "Merlin?" (same card, no hint that it is certain).
4. **The Assassin may name Evil players or Oberon**; that simply misses, so the strike screen reveals nothing.
