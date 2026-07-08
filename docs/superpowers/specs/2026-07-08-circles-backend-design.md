# Retainflow — Accountability Circles (backend)

**Date:** 2026-07-08
**Status:** Approved

---

## Overview

Backend support for "Accountability Circles" in the muraja-native client (Phase 3 of that app's redesign — see the companion client spec at `C:\Users\Amir_\muraja-native\docs\superpowers\specs\2026-07-08-circles-client-design.md`). A circle is a small named group (invite-code join) whose members can see each other's real memorisation streak, last-reviewed item, and send lightweight "cheer" reactions. No chat, no admin/moderation beyond leave, no XP.

This is the first feature in this codebase where one user's data becomes visible to another — every new query must be scoped to "members of a circle I'm also in," never a general cross-user read.

## Threat model

- **New cross-user data exposure, by design, but must be tightly scoped.** A user's `display_name`, streak, and last-reviewed item become visible to other members of circles they share. This must never leak to users who aren't in a shared circle — every circle-member-list query joins through `circle_members` filtered to the requesting user's own circle membership, never a bare `SELECT ... FROM users`.
- **Invite codes are the only access control for joining.** They must be unguessable enough to not be brute-forced (short alphanumeric codes like the prototype's `JUZ-30-HIFZ` are memorable but low-entropy) — generate codes with enough randomness to resist casual guessing (e.g. 8+ random alphanumeric chars), and rate-limit the join endpoint so brute-forcing a valid code isn't practical.
- **`display_name` is free-text user input** — stored and later rendered in the client's UI. No HTML/script injection risk server-side (SQLite storage, JSON API — the client is responsible for safe rendering, same as `content`/`notes` fields already are), but cap length (e.g. 40 chars) and reject empty-after-trim to keep it a real display name.
- **No new secrets, no new auth mechanism.** Reuses the existing `Authorization: Bearer <user_id>` convention — anonymous UUID is still the sole credential, same trust model as every other endpoint.
- **Cheers could be spammed** (repeatedly cheering the same member) — cap identically to other write endpoints via the existing rate-limit middleware pattern (`config: { rateLimit: { max: N, timeWindow: '1 minute' } }`).

## Stack decisions

No new dependencies. Same Fastify + `better-sqlite3` stack, same `db.exec`/`db.prepare` patterns, same `user_version` migration pragma pattern already used for the `items` table's two prior migrations (`database.ts` lines 75-102).

## File and folder structure

Modified:
- `backend/src/database.ts` — add `display_name` column migration (M3), 3 new tables (`circles`, `circle_members`, `circle_cheers`), and new query helper functions (`setDisplayName`, `createCircle`, `joinCircle`, `leaveCircle`, `getUserCircles`, `getCircleDetail`, `addCheer`).
- `backend/src/server.ts` — 7 new routes (see Data and control flow below).

No new files — this repo's convention keeps all DB helpers in `database.ts` and all routes in `server.ts` (confirmed by reading both files; not introducing a new module structure this codebase doesn't already use).

## Data and control flow

### Schema (migration M3, `user_version = 3`)

```sql
-- Added to existing users table via ALTER (guarded by PRAGMA table_info check, same pattern as M1)
ALTER TABLE users ADD COLUMN display_name TEXT;

CREATE TABLE IF NOT EXISTS circles (
  id            TEXT PRIMARY KEY,           -- generated, e.g. crypto.randomUUID()
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  invite_code   TEXT NOT NULL UNIQUE,       -- e.g. 8-char random alphanumeric
  creator_user_id TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (creator_user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS circle_members (
  circle_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  joined_at  INTEGER NOT NULL,
  PRIMARY KEY (circle_id, user_id),
  FOREIGN KEY (circle_id) REFERENCES circles(id),
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS circle_cheers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  circle_id     TEXT NOT NULL,
  from_user_id  TEXT NOT NULL,
  to_user_id    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (circle_id) REFERENCES circles(id)
);
CREATE INDEX IF NOT EXISTS idx_cheers_to ON circle_cheers(circle_id, to_user_id);
```

Caps (enforced in the route handlers, not the schema): a user may belong to at most **5** circles; a circle may have at most **20** members. Both checked with a `COUNT(*)` query before the insert, returning `403` with a clear message if exceeded (matching the existing free-plan-cap pattern already used for item limits elsewhere in this codebase).

### Endpoints

- `PUT /api/me/display_name` — body `{ display_name: string }`. Trims, rejects empty/over-40-chars with `400`, upserts onto the caller's `users` row.
- `POST /api/circles` — body `{ name: string, description?: string }`. Generates a unique `invite_code`, creates the circle, inserts the creator as the first `circle_members` row. Enforces the 5-circles-per-user cap first (`403` if at cap). Returns the created circle including its `invite_code`.
- `POST /api/circles/join` — body `{ invite_code: string }`. Looks up the circle by code (`404` if not found), enforces the 5-per-user and 20-per-circle caps (`403` with distinct messages), inserts a `circle_members` row (idempotent — re-joining an already-joined circle is a no-op success, not an error). Rate-limited (`max: 10, timeWindow: '1 minute'`) to blunt invite-code brute-forcing.
- `POST /api/circles/:id/leave` — removes the caller's `circle_members` row. If the caller is the creator and other members remain, leaving is still allowed (no special-cased "creator can't leave" rule — this is a lightweight accountability feature, not a governed community; the circle simply has no formal owner after the creator leaves, and it stays visible/joinable via its existing invite code for remaining/future members). If the leaving member was the last one, delete the circle row too (no orphaned empty circles).
- `GET /api/circles` — list circles the caller is a member of (id, name, description, member count). No invite code exposed here except to the creator (or: expose it to any current member so anyone can re-share the invite — simpler, no special-casing; use this simpler behavior).
- `GET /api/circles/:id` — `404` if the caller isn't a member (this is the critical scoping check — verify membership BEFORE returning any member data). Returns circle details plus each member's: `user_id` (needed for the cheer-target param, not shown as text in the UI), `display_name` (fallback to a literal `"Anonymous"` string server-side if null, so the client never has to special-case a missing name), computed `streak` (same day-counting logic as the client's local `calcStreak`, now computed server-side from `review_log.reviewed_at` for that `user_id`), `last_reviewed_item_id` + `last_reviewed_at` (most recent `review_log` row for that user, joined to `items.content` is NOT needed — the client already knows how to pretty-print an `item_id` via its existing `prettyItemId()` helper, so just return the raw `item_id`), and `cheer_count` (count of `circle_cheers` where `to_user_id` = that member, scoped to this circle).
- `POST /api/circles/:id/cheer/:userId` — `404` if caller isn't a member of `:id`, or if `:userId` isn't a member of `:id`. Inserts a `circle_cheers` row. Rate-limited (`max: 20, timeWindow: '1 minute'`) — cheering is low-stakes and more frequent than circle creation/joining, so a higher cap than the join endpoint.

## Error handling

- Every circle-scoped endpoint (`GET /api/circles/:id`, leave, cheer) checks membership first and returns `404` (not `403`) for both "circle doesn't exist" and "you're not a member" — deliberately not distinguishing the two in the response, so a non-member can't use error-message differences to enumerate which circle IDs/invite codes are valid.
- Cap violations return `403` with a message identifying which cap was hit (`"You can only join up to 5 circles"` / `"This circle is full (20 members max)"`), distinct from the generic `404`.
- `POST /api/circles/join` with an invite code that doesn't exist: `404 { error: 'invite code not found' }`.
- Standard `400` validation errors for missing/malformed body fields, matching every other endpoint's existing style.

## Security requirements

1. Every query that returns another user's data (`display_name`, streak, last-reviewed item, cheer count) MUST be reachable only through a circle-membership join — no endpoint may return this data to a caller who isn't a member of a shared circle. Verify membership with an explicit query before the data query, not by relying on a `WHERE` clause alone (defense in depth against a future refactor accidentally weakening the join).
2. Invite codes must be generated with a cryptographically-fine random source (`crypto.randomBytes`/`randomUUID`-derived, not `Math.random()`), matching this codebase's existing stance on `getUserId()`'s own UUID generation (documented in the client's `CLAUDE.md`).
3. Rate-limit `POST /api/circles/join` and `POST /api/circles/:id/cheer/:userId` (brute-force and spam vectors respectively) using the existing `@fastify/rate-limit` config pattern already used on `/api/items` and `/api/quran/search`.
4. `display_name` length-capped and trimmed server-side; never trust client-side validation alone.
5. CORS: no new methods beyond the already-registered `['GET', 'HEAD', 'POST', 'PUT', 'DELETE']` — confirm the new routes use only these verbs (they do: GET/POST/PUT only, per the endpoint list above).

## Dependencies

None added.

## Deployment steps

Standard deploy (this service already auto-migrates on boot via the `user_version` pragma check in `initDb()` — no manual migration step needed, consistent with how M1/M2 shipped). No new environment variables, no new external services.

## Explicitly out of scope

- Circle moderation (removing another member, transferring ownership, renaming after creation) — leave-only for v1, per the approved design.
- Live ladder-rep-progress sync — "current activity" is the last real `review_log` entry, not live in-progress rep counts; syncing the Lawhah ladder to the backend is a separate, larger project not undertaken here.
- Push notifications for cheers/circle activity.
- Any change to the existing anonymous-identity model beyond adding an optional display name.

## Testing / verification

Check `backend/package.json`'s test setup before assuming `npm test` works — `CLAUDE.md` notes `package.json` is currently mismatched with the lockfile; verify by running `node_modules/.bin/vitest run tests/server.test.ts` directly (the documented workaround) rather than assuming `npm test` succeeds. If a real test suite exists and runs via that path, add tests for: circle creation enforces the 5-per-user cap, join enforces the 20-per-circle cap and rejects invalid codes, `GET /api/circles/:id` returns `404` for non-members, cheer requires shared membership, streak calculation matches the client's existing day-counting logic for a few representative `review_log` fixtures (consecutive days, a gap, same-day multiple reviews).
