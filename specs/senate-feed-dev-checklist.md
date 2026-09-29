# Senate Vote Feed: Development Checklist

Use this checklist to track Senate vote-feed support in the Supabase development project and Vercel Preview deployments.

## Scope

- [ ] Build the roster, vote-storage, ingestion, and member-record API support needed for Senate votes.
- [ ] Keep the existing House feed working.
- [ ] Leave the user-facing choice of showing both Senators or selecting one to the separate feed-behavior ticket.
- [ ] Keep database migrations and vote-sync deployment on the Supabase development project. Confirm Vercel Preview environment variables point to development services.
- [ ] Leave vote notifications out of scope unless they are added as a separate requirement.

## 1. Senator roster lookup

- [x] Confirm the development `reps` table contains current Senate members, with state, chamber, and current-member status populated.
- [x] Add a state-and-chamber query that returns all current Senators for one state as an array.
- [x] Add an API route for that lookup and document its response shape.
- [x] Return the current rows without requiring that a state always has exactly two Senators.
- [ ] Exercise the response for a real Senate vacancy when one appears in the development roster; the September 28, 2026 refresh had two current Senators in each of the 50 states.

Likely files: `server/src/api/reps.js`, `server/src/db/queries/reps.js`, and the development roster-sync path.

Development roster refresh on September 28, 2026: 427 current House members and 100 current Senators were synced; all 100 Senate rows have `last_seen_at` populated.

## 2. Chamber-aware database migration

- [x] Create an additive Supabase migration for the development database.
- [x] Add `chamber` to `member_voting_record` and `roll_call_summaries`.
- [x] Backfill existing vote and summary rows as House records, then make the new values required if compatible with the data.
- [x] Update vote uniqueness to include chamber, such as `(member_id, chamber, session_number, roll_call_number)`.
- [x] Update roll-call summary uniqueness to include chamber, such as `(chamber, session_number, roll_call_number)`.
- [x] Update all sync upsert conflict targets and query joins to use the new keys.
- [x] Keep `server/src/db/schema.sql` aligned for fresh database setups. This file starts by dropping tables; do not use it to migrate the existing Supabase development database.

Likely files: a new migration under `supabase/migrations/`, `server/src/db/schema.sql`, and the vote-sync code that writes these tables.

## 3. Senate vote ingestion

- [ ] Confirm the Senate vote endpoint and response fields in the current Congress.gov API reference.
- [ ] Fetch the Senate roll-call list with pagination.
- [ ] Fetch each roll call's member votes and summary, reusing the House sync's retry and error-handling patterns where they fit.
- [ ] Store `chamber = Senate` on each vote and summary.
- [ ] Ensure measure metadata exists in `bills`; the member-feed query joins to that table.
- [ ] Track the newest sync time separately for each chamber so House activity cannot skip Senate votes.
- [ ] Make repeat syncs idempotent using the chamber-aware keys.
- [ ] Deploy the updated sync function to the Supabase development project only.

Likely file: `supabase/functions/sync-votes/index.ts` and any shared vote-sync helpers or types.

## 4. Member vote-reading API

- [ ] Add a chamber-neutral member-vote route, preserving the existing House route for compatibility during the transition.
- [ ] Add an optional chamber filter to the member-vote query and apply it before the latest-vote-per-bill selection.
- [ ] Include chamber in the roll-call summary join.
- [ ] Preserve House results and existing pagination and policy-area behavior.
- [ ] Confirm the API returns only the requested chamber when a chamber filter is supplied.

Likely files: `server/src/api/houseVotes.js`, `server/src/db/queries/houseVotes.js`, and `server/app.js`.

## 5. Vercel Preview integration

- [ ] Confirm the Vercel Preview API and client use the Supabase development project.
- [ ] Connect the preview client to the Senator lookup and member-vote API according to the separate feed-behavior ticket.
- [ ] Derive `Sen.` or `Rep.` from stored member chamber data; derive the measure label from legislation type.
- [ ] Check guest and signed-in entry points that currently resolve a representative by district.

Likely files: `client/src/LandingPage.jsx`, `client/src/Feed.jsx`, `server/src/api/users.js`, and related feed components.

## 6. Development verification

- [ ] A state lookup returns its current Senators from the development database.
- [ ] A known Senate roll call stores the expected member votes and roll-call summary with Senate chamber values.
- [ ] A House and Senate roll call with the same session and roll-call numbers remain separate.
- [ ] Running the Senate sync twice does not create duplicate vote or summary rows.
- [ ] A Senate-filtered member query returns Senate votes and matching summaries.
- [ ] The existing House feed still returns House votes and matching summaries.
- [ ] The Vercel Preview UI can load the Senate data while connected to development services.

## Current code landmarks

- Roster API and query: `server/src/api/reps.js`, `server/src/db/queries/reps.js`
- Member and roll-call schema: `server/src/db/schema.sql`
- House vote API and persistence/query code: `server/src/api/houseVotes.js`, `server/src/db/queries/houseVotes.js`
- Supabase Edge Function vote-sync implementation: `supabase/functions/sync-votes/index.ts`
- Current signed-in feed lookup: `server/src/api/users.js`
- Guest feed entry and rendering: `client/src/LandingPage.jsx`, `client/src/Feed.jsx`
