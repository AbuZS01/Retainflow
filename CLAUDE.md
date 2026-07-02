# Retainflow

## Backend gotchas

- **CORS methods must be explicit.** `@fastify/cors` (registered in `backend/src/server.ts`)
  defaults `methods` to `'GET,HEAD,POST'` if not specified. PUT and DELETE routes (reschedule,
  review, notes, snooze, undo-review, item deletion) will silently fail preflight from any
  browser origin — surfaces as `TypeError: Failed to fetch` — while working fine from the
  native app (no browser CORS enforcement there). Keep `methods: ['GET', 'HEAD', 'POST', 'PUT',
  'DELETE']` (and `allowedHeaders` covering `Authorization`/`Content-Type`) set explicitly in the
  `fastifyCors` registration.

- **`backend/package.json` is mismatched with `backend/package-lock.json`.** The lockfile is for
  `retainflow-backend` (Fastify + vitest), but `package.json` currently contains the
  `muraja-native` Expo app's manifest (`expo start` scripts, RN/Expo deps). This means
  `npm test` / `npm run dev` don't work as expected — run tools directly instead, e.g.
  `node_modules/.bin/vitest run tests/server.test.ts` or `node_modules/.bin/tsx <script>`.
  Worth fixing properly (restore the correct `package.json`) rather than working around it
  long-term.

## Repo layout note

- There is a second, older nested clone at `Retainflow/Retainflow/` (same git remote, different/
  stale commit history, with its own uncommitted changes). The canonical working copy is the
  repo root (`C:\Users\Amir_\Retainflow`) — don't edit files under the nested `Retainflow/Retainflow/`
  path unless specifically asked to reconcile it.
