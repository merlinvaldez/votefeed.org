# Senate Vote Feed: Development Checklist

Use this checklist to track Senate vote-feed support in the Supabase development project and Vercel Preview deployments.

## Desired user behavior

- A user who has vote notifications enabled receives one daily email containing all new eligible vote updates for their House representative and both current Senators from their state.
- The email groups updates under House and Senate headings and identifies each member by name and title. Email notifications include both current Senators for the user's state, regardless of the separate feed display choice. Users do not receive separate emails for each member or chamber during the same daily digest.
- The digest is sent only when there is at least one new eligible update. It continues to honor the existing summary-readiness requirement; if an update is not ready, the pending digest is held so that updates are not split across emails.
- "Eligible" keeps the current notification rule: votes need bill context with the required summaries. Nominations and unrelated procedural votes remain outside the email unless that rule is expanded separately.
- The digest runs once per day after the scheduled vote syncs have had a chance to finish. The deployment must record the send time and time zone.

## Scope

- [ ] Build the roster, vote-storage, ingestion, and member-record API support needed for Senate votes.
- [ ] Keep the existing House feed working.
- [ ] Leave the user-facing choice of showing both Senators or selecting one to the separate feed-behavior ticket.
- [ ] Keep database migrations and vote-sync deployment on the Supabase development project. Confirm Vercel Preview environment variables point to development services.
- [ ] Add the combined daily vote-notification digest described below while preserving the existing House notification behavior.

## Implementation steps

### 1. Senator roster lookup

- [x] Confirm the development `reps` table contains current Senate members, with state, chamber, and current-member status populated.
- [x] Add a state-and-chamber query that returns all current Senators for one state as an array.
- [x] Add an API route for that lookup and document its response shape.
- [x] Return the current rows without requiring that a state always has exactly two Senators.
- [ ] Exercise the response for a real Senate vacancy when one appears in the development roster; the September 28, 2026 refresh had two current Senators in each of the 50 states.

Likely files: `server/src/api/reps.js`, `server/src/db/queries/reps.js`, and the development roster-sync path.

Development roster refresh on September 28, 2026: 427 current House members and 100 current Senators were synced; all 100 Senate rows have `last_seen_at` populated.

### 2. Chamber-aware database migration

- [x] Create an additive Supabase migration for the development database.
- [x] Add `chamber` to `member_voting_record` and `roll_call_summaries`.
- [x] Backfill existing vote and summary rows as House records, then make the new values required if compatible with the data.
- [x] Update vote uniqueness to include chamber, such as `(member_id, chamber, session_number, roll_call_number)`.
- [x] Update roll-call summary uniqueness to include chamber, such as `(chamber, session_number, roll_call_number)`.
- [x] Include Congress in both vote identities and remove the older member-vote index that still omitted chamber.
- [x] Update all sync upsert conflict targets and query joins to use the new keys.
- [x] Keep `server/src/db/schema.sql` aligned for fresh database setups. This file starts by dropping tables; do not use it to migrate the existing Supabase development database.

Likely files: a new migration under `supabase/migrations/`, `server/src/db/schema.sql`, and the vote-sync code that writes these tables.

### 3. Senate vote ingestion

- [x] Fetch the official Senate vote menu and roll-call XML from `senate.gov`.
- [x] Parse the XML into validated vote summaries and complete member positions; map Senate LIS IDs to Bioguide IDs.
- [x] Store `chamber = Senate` and Congress on each vote and summary.
- [x] Link real bill measures to `bills`; keep nominations and unrelated procedure votes unlinked rather than inventing a bill.
- [x] Track completed Senate roll calls independently and retry partial writes.
- [x] Make repeat writes idempotent with chamber- and Congress-aware keys.
- [x] Deploy the dedicated `sync-senate-votes` function and quarter-hour schedule to the Supabase development project.
- [x] Restore the House-only `sync-votes` function and deploy it to development.

Files: `supabase/functions/sync-senate-votes/`, `supabase/functions/sync-votes/index.ts`, and the two Senate repair migrations.

### 4. Member vote-reading API

- [x] Add a chamber-neutral member-vote route, preserving the existing House route for compatibility during the transition.
- [x] Add an optional chamber filter to the member-vote query and apply it before the latest-vote-per-bill selection.
- [x] Include chamber in the roll-call summary join.
- [x] Preserve House results and existing pagination and policy-area behavior.
- [x] Confirm the API returns only the requested chamber when a chamber filter is supplied.

Likely files: `server/src/api/houseVotes.js`, `server/src/db/queries/houseVotes.js`, and `server/app.js`.

### 5. Vercel Preview backend integration

- [x] Confirm the Vercel Preview API serves data matching Supabase development. The September 30, 2026 backend Preview returned New York's two current Senators and Schumer's Senate vote on 119/2/254 (`Nay`), matching the `votefeed-dev` database. This verifies runtime data; the Vercel environment variable value was not exposed by the available project tool.
- [x] Confirm the Preview API exposes the Senator lookup and chamber-filtered member-vote routes. `GET /reps/state/New%20York/senators` and `GET /membervotes/S000148?chamber=Senate&limit=1` returned 200.
- [x] Confirm the Preview API continues to resolve a House district and read House votes. `GET /reps/district/New%20York/10` and `GET /membervotes/G000599?chamber=House&limit=1` returned 200.

The client connection, Senator display choice, member titles, measure labels, and guest/signed-in feed entry points belong to the separate feed-behavior ticket. They have not been changed or verified here. The Preview client's environment target still needs confirmation during that ticket.

### 6. Combined daily vote-notification digest

- [ ] Extend the notification outbox to record chamber and Congress, then update its idempotency key so House and Senate roll calls with overlapping numbers remain separate.
- [ ] Queue newly completed Senate bill votes for notification after the vote and summary records are safely stored. Keep House vote queuing and retry behavior working.
- [ ] Store notification progress separately for House and Senate, including Congress, so one chamber's roll-call number cannot suppress an update from the other chamber.
- [ ] Update `send-vote-notifications` to gather pending eligible votes for each enabled user across both chambers before sending. Match House votes by state and district and Senate votes by state.
- [ ] Send at most one email per user per daily digest, with all ready House and Senate updates grouped by chamber and member. If any update in that user's pending digest is still waiting for required summaries, hold the digest and retry it on the next run rather than sending a partial email.
- [ ] Update the subject and body to use the correct member titles and make clear which chamber and member each vote belongs to.
- [ ] Add or update the Supabase development cron schedule to invoke the combined sender once daily after vote synchronization. Record the configured time and time zone, and ensure there is only one active daily sender schedule.
- [ ] Keep opt-outs, retries, dead-letter handling, and idempotent delivery intact; a retry must not send the same vote twice.

Likely files: a new migration under `supabase/migrations/`, `server/src/db/schema.sql`, `supabase/functions/sync-senate-votes/`, `supabase/functions/sync-votes/index.ts`, and `supabase/functions/send-vote-notifications/index.ts`.

## Current code landmarks

- Roster API and query: `server/src/api/reps.js`, `server/src/db/queries/reps.js`
- Member and roll-call schema: `server/src/db/schema.sql`
- House vote API and persistence/query code: `server/src/api/houseVotes.js`, `server/src/db/queries/houseVotes.js`
- Supabase Edge Function vote-sync implementation: `supabase/functions/sync-votes/index.ts`
- Current signed-in feed lookup: `server/src/api/users.js`
- Guest feed entry and rendering: `client/src/LandingPage.jsx`, `client/src/Feed.jsx`

## How to check it works

- [x] A state lookup returns its current Senators from the development database via the Vercel Preview API.
- [x] Senate roll call 119/2/251 stores 100 member positions and the official 48-51-1 tally.
- [x] House and Senate roll call 119/2/251 have separate summary rows.
- [x] Reprocessing 119/2/251 left one summary and 100 member positions; all completed roll calls have matching stored member counts.
- [x] A Senate-filtered member query returns Senate votes and matching summaries through the Vercel Preview API.
- [x] The development House `sync-votes` endpoint returned 200 after the schema repair, with no new duplicate votes.
- [x] A House-filtered member query returns House votes and matching summaries through the Vercel Preview API. The signed-in feed route remains for the later feed ticket.
- [ ] With new eligible House votes and votes from both current Senators, an enabled user receives exactly one daily email containing all three offices, grouped and labeled correctly.
- [ ] With updates from only one chamber, the user receives one digest for that chamber; with no new eligible votes or notifications disabled, no email is sent.
- [ ] A pending vote whose required summary is not ready holds that user's digest; once ready, the update arrives in the next digest without duplicates or a separate chamber email.
- [ ] House and Senate votes with the same session and roll-call numbers both appear and advance independent notification progress.
- [ ] The active development schedule invokes the sender once per day after vote sync, and its configured time zone is documented.
