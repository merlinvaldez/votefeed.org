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

- [x] Extend the notification outbox to record chamber and Congress, then update its idempotency key so House and Senate roll calls with overlapping numbers remain separate. Applied to `votefeed-dev` (`kddqnmenstoilnzwajnb`) on October 19, 2026; confirmed all 66,335 existing rows are House/Congress 119 and verified the required columns, expanded unique index, and Supabase migration version `20261019144414`.
- [x] Queue newly completed Senate bill votes for notification after the vote and summary records are safely stored. Keep House vote queuing and retry behavior working. Deployed `sync-senate-votes` v4 to `votefeed-dev`; it now fills missing official bill summaries on existing bill records as well as inserting bill metadata for new records. House `sync-votes` v35 also backfills official bill titles for new House votes and supports the bounded pending-bill metadata repair used for the current digest.
- [x] Store notification progress separately for House and Senate, including Congress, so one chamber's roll-call number cannot suppress an update from the other chamber. Applied to `votefeed-dev` in migration `20261019154303_combined_daily_vote_notification_digest`; the new RLS-protected progress table is keyed by user, chamber, and Congress, and existing House cursors were copied into Congress 119.
- [x] Update `send-vote-notifications` to gather pending eligible votes for each enabled user across both chambers before sending. Match House votes by state and district and Senate votes by state. The inclusive cutoff is September 15, 2026 at midnight America/New_York (`2026-09-15T04:00:00Z`); the read-only dev preview matched 11 House and 34 Senate votes for one enabled user, and 1 House and 34 Senate votes for the other.
- [x] Send at most one email per user per daily digest containing the new House and/or Senate updates ready at send time. A digest waits if any matching new vote still lacks its required summary; when ready, the vote advances the next digest without an extra chamber-specific email.
- [x] Keep the subject and body simple and close to the current format. The sender uses the existing vote-summary style, and each line identifies the member with `Rep.`, `Sen.`, or `Sens.` and their name, with no chamber sections or callouts. Senate votes on the same roll call and bill share one line when the Senators agree; differing positions stay on separate lines, matching the feed grouping.
- [x] Add or update the Supabase development cron schedule to invoke the combined sender once daily after vote synchronization. The sole active sender schedule is 10:30 UTC, after the 09:00 UTC House sync and 10:15 UTC Senate sync.
- [x] Keep opt-outs, retries, dead-letter handling, and idempotent delivery intact; a retry must not send the same vote twice. The sender advances per-chamber cursors after successful delivery, uses a stable Resend idempotency key for a digest's outbox rows, and dead-letters after five failures.

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
- [x] A full send was triggered on `votefeed-dev` after a read-only preview returned HTTP 200 with two send-ready combined digests: user 3 had 45 votes (11 House, 34 Senate), and user 4 had 35 (1 House, 34 Senate), all dated September 15–30, with no summary blockers. Resend accepted both emails; the sender generated 17 AI summaries with zero summary or send failures and processed all 6,395 pending outbox rows. No pending outbox rows remain, and both users' House and Senate progress cursors advanced to session 2 roll calls 314 and 254 respectively. Follow-up found a stale prompt-like H.R. 9340 `aisummary`; sender v26 rejects prompt echoes and checks key legal qualifiers, including `consider`, against the official summary. The bad cache was regenerated in `generate-only` mode without another email, then tightened to a concise phrase that preserves the requirement for regulators and utilities to consider rules. No prompt-like cached summaries or pending outbox rows remain. Sender v27 now groups matching Senate positions on the same roll call and bill into one line and keeps differing positions separate; all 17 digest and summary tests passed.
- [x] With updates from only one chamber, the selection logic produces a chamber-only digest; with no new eligible votes, it produces no digest. Notifications-disabled users are excluded by the sender's user query.
- [x] A pending vote whose required summary is not ready holds that user's digest; unit coverage verifies the vote is included in the next digest when its summary becomes ready.
- [x] House and Senate votes with the same session and roll-call numbers advance independent notification progress through the chamber-and-Congress cursor key.
- [x] The active development schedule invokes the sender once per day after vote sync at 10:30 UTC; the time zone is recorded in the schedule name and migration.
- [x] Backfilled 1,700 completed Senate member-vote rows from 17 bill roll calls dated September 15–30, 2026. Migration `20261019154813_seed_senate_vote_notification_backlog` required both the ingestion completion marker and roll-call summary and inserted no pre-cutoff votes.
