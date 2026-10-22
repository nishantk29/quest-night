# Quest Night

A hidden-traitor quest game for 5 to 10 players, one phone each, no moderator. Sister app to
[Mafia Night](https://mafia-app.hatethespurs.workers.dev): same stack, same design system, its own game.

Live: https://quest-night.hatethespurs.workers.dev

## How it plays
- Most players are **the Loyal**; 2 to 4 are **the Shadow** and know each other.
- A rotating **leader** (the crown) proposes a party; everyone votes approve/reject, shown together. Strict
  majority passes. Five rejected parties in a row: the Shadow wins.
- The party plays Success/Sabotage face down (Loyal can only play Success). One sabotage fails a quest, except
  quest 4 at 7+ players, which needs two. Three quests decide.
- Optional cards (host settings): the Seer + the Assassin (pair), the Herald, the Enchantress, the Usurper, the
  Outcast. If the Seer is in play and the Loyal win three quests, the Assassin gets one strike at the Seer.

## Code
- `public/js/rules.js`: pure rules (table sizes, quest sizes, two-fail rule, role deal, who sees whom).
- `public/js/room.js`: the reducer for every action plus `viewForPlayer` (all secrecy lives here).
- `src/worker.js`: Cloudflare Worker + one Durable Object per room (WebSocket hibernation), copied from Mafia Night.
- `public/js/app.js`: the whole client (hash routing, live socket, screens). `public/styles.css`: Mafia Night's
  tokens/components plus Quest Night's track, round table, vote and quest reveals.

## Run and test (Node 22+)
- `npm test`: rules and reducer tests, including secrecy.
- `npx wrangler dev --port 8861 --ip 127.0.0.1`, then `BASE=http://127.0.0.1:8861 GAMES=40 SEED=1 node scripts/sim-games.mjs`
  plays whole games with scripted players (no LLM) and checks secrecy, vote/quest/assassin outcomes and the
  five-reject rule. Every run must end `problems: 0`.

## Deploy
- `npm run deploy` (stamps the service-worker version, then `wrangler deploy`) with `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` set, or the manual **Deploy** GitHub Action once those two repo secrets are added
  (same as Mafia Night). Workers.dev only: no custom domain, no DNS.
- After deploying: `BASE=https://quest-night.hatethespurs.workers.dev GAMES=6 node scripts/sim-games.mjs`.

> The GitHub Actions files live in `docs/github-workflows/` for now: the box's GitHub login can't write
> `.github/workflows` (no `workflow` scope). Move them to `.github/workflows/` from a login that can.
