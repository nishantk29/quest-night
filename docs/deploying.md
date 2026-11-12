# Deploying Quest Night

## With Wrangler (normal path)

1. Refresh the service-worker version so installed phones pick up the change:
   `node scripts/stamp-sw.mjs public` (or `npm run stamp`). `test/pwa-fresh.test.js` fails if it is stale.
2. Run `npm test`.
3. Run `npm run deploy` (`wrangler deploy`) with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set.
   This uploads the Worker and `public/` as Workers Static Assets.

## With GitHub Actions

`docs/github-workflows/deploy.yml` runs on manual dispatch only: `npm ci`, `npm test`, `npm run deploy`, then a
short live smoke test. `test.yml` runs `npm test` on every push and pull request. GitHub only runs workflows from
`.github/workflows/`, so move both files there to turn them on. Add `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` as repository secrets.

## After a deploy

Play a few scripted games against the live site. The run must end with `problems: 0`:

```sh
BASE=https://avalon.hatethespurs.com GAMES=6 node scripts/sim-games.mjs
```

## Configuration notes

- `wrangler.jsonc` is the single source for the Worker name (`quest-night`), the bindings (`ROOM` -> `Room`,
  `AI`, `AI_MODE`) and the compatibility date. The deploy scripts read them from there; never pass them by hand.
- **Durable Object migration:** the only migration is tag `v1` with `new_sqlite_classes: ["Room"]`, so the Room
  class is SQLite-backed. A class's storage backend cannot be changed after it is created, so don't edit or reorder
  this migration; add a new tag for any future class change. `test/deploy-config.test.js` pins it.
- `workers_dev: true` and `preview_urls: false` match the live Worker. `test/deploy-workersdev.test.js` pins them.
- The custom domain is not set in `wrangler.jsonc` (there are no `routes`), so it is managed on the Cloudflare side.
- `AI_MODE` is `"dark"`: the rules helper exists on the server but never calls a model. Only `"on"` enables it.

## Deploying through the Cloudflare API without Wrangler

For a machine with no Wrangler token, the repo can build a single-file Worker with every file in `public/` inlined:

```sh
node scripts/stamp-sw.mjs public          # first: build-deploy refuses a stale service-worker version
node scripts/build-embedded.mjs           # writes dist-embedded/worker.js
node scripts/build-deploy.mjs <outFile>   # runs the whole test suite first; no secrets embedded
```

`build-deploy` writes a deploy file that uploads the script through the Cloudflare API with the name, bindings and
compatibility date from `wrangler.jsonc`, and sends no migrations. If any test fails it prints
`Deploy file NOT written: N test(s) failed`, exits 1 and leaves `<outFile>` untouched. There is no bypass flag.
A later `npm run deploy` replaces the embedded build with the normal Static Assets build; the migration tag matches.
