# voteFeed

## 30 Second Pitch

VoteFeed lets constituents see how their U.S. House representative and senators voted, compare their positions, and respond with approval, disapproval, and comments.

## Senate Release

This branch adds a delegation feed with All Reps, House, and Senate filters; combined cards for matching Senate actions; member-specific responses; and bill detail folders that retain a shared simplified summary. Vacant seats do not prevent the remaining delegation from loading. Clearing a response preserves its comments.

See [release notes](RELEASE_NOTES.md) for the release scope and the [production rollout checklist](specs/production-rollout-checklist.md) for verified progress. The notes describe the release candidate; application deployment and production browser acceptance are still pending.

## Development And Verification

From the repository root in PowerShell:

```powershell
npm.cmd run dev
# In a separate terminal:
npm.cmd run test:all
```

`test:all` runs PostgreSQL-backed Node tests, Deno notification tests, client ESLint, and a Vite production build. Install root, client, and server dependencies first. The Windows runner expects PostgreSQL 18 in `C:\Program Files\PostgreSQL\18\bin` and Node/npm in `C:\Program Files\nodejs`. Its disposable PostgreSQL cluster uses `%TEMP%\voteFeed-test-postgres` on `127.0.0.1:55439`. The runner starts/stops the cluster when needed and restores test flags afterward. It does not apply the complete Supabase migration chain or replace browser acceptance.

Run `npm.cmd run test:postgres` for only the Node/database suite. The runner sets `ALIGNMENT_TEST_POSTGRES`, `BATCH_STANCES_TEST_POSTGRES`, and `DELEGATION_TEST_POSTGRES`; these and `CARD_PREVIEW_PORT` are test settings, not production variables.

The client resolves its API base from `VITE_API_URL`, then `VITE_API_BASE`, then the related Vercel backend injected as `VITE_RELATED_API_URL`, then `http://localhost:4000`. `client/vite.config.js` names related project `votefeed-org-backend`. Explicit production API settings are build-time inputs; changes require a new build. Keep credentials on the server, never in `VITE_*` variables.

## MVP V1 Features (FSA Release)

- Any user can enter an address and see a cascading feed of their district's assigned U.S. representative's voting record.
  - Determine congressional district from an address with the U.S. Census Geocoder API.
  - Get the representative serving that district from Congress.gov.
  - Get House vote data and member-by-member vote records from Congress.gov.
- Users can register and log in.
- Authorized users can:
  - Save their address, district, and U.S. House representative.
  - Approve or disapprove of a bill.
  - Leave a comment explaining their position.

## MVP V2 Features (Public Release)

- Organize the feed based on bill interests.
- Show how other constituents in the district are voting and commenting on bills.
- Show more bill and representative information, such as:
  - Vote date
  - Bill type
  - Bill contents
  - Representative photo
  - Representative page link
- Add third-party login/signup.
- Send authorized users' comments directly to representatives by email.
- Moderate comment language.
- Show how closely the user aligns with their representative.
- Notify users about new votes from their representative.

## Stretch Features

- Allow users to approve/disapprove and comment on bills before they are voted on.
- Show an upcoming legislative agenda feed.
- Link out to external bill documents.
- Generate AI pro/con bill breakdowns.
- Use AI to help draft comments to representatives.
- Let users click into terms and ask "what is this?" for civic definitions.
- Ensure comments stay directed to the bill in question.

## Project Management System

[VoteFeed Dev](https://www.notion.so/VoteFeed-Dev-2c7155d4c85080bebe06d6905a3a50cf?pvs=21)

## Current DB Schema

This section summarizes the branch's schema and migrations. `server/src/db/schema.sql` is a destructive development reset, not a production upgrade procedure; it does not replace the migration chain, including feed snapshot setup. Use the rollout checklist for production changes.

### users

| Column        | Type    | Constraints |
| ------------- | ------- | ----------- |
| id            | serial  | Primary key |
| email         | text    | Unique      |
| clerk_user_id | text    | Unique      |
| first_name    | text    | Nullable    |
| last_name     | text    | Nullable    |
| state         | text    | Nullable    |
| district      | integer | Nullable    |
| notifications_enabled | boolean | Not null, defaults to `true` |
| last_notified_session_number | integer | Nullable |
| last_notified_roll_call_number | integer | Nullable |

### reps

| Column                | Type    | Constraints |
| --------------------- | ------- | ----------- |
| bioguideId            | text    | Primary key |
| full_name             | text    | Not null    |
| party                 | text    | Not null    |
| chamber               | text    | Not null    |
| state                 | text    | Not null    |
| congressionalDistrict | integer | Nullable    |
| image_url             | text    | Nullable    |
| is_current_member     | boolean | Not null, defaults to `true` |
| last_seen_at          | timestamptz | Nullable |

### bills

| Column    | Type    | Constraints |
| --------- | ------- | ----------- |
| id        | serial  | Primary key |
| number    | integer | Not null    |
| bill_type | text    | Nullable    |
| title     | text    | Not null    |
| summary   | text    | Not null    |
| aisummary | text    | Nullable    |
| policy_area | text  | Nullable    |
| legislation_url | text | Nullable |

Deployed environments also use:

- `idx_bills_bill_type_number` on `(bill_type, number)` so bill summaries can be safely upserted without duplicates.

### roll_call_summaries

| Column            | Type        | Constraints |
| ----------------- | ----------- | ----------- |
| id                | serial      | Primary key |
| legislation_number | integer   | Nullable    |
| legislation_type  | text        | Nullable    |
| session_number    | integer     | Not null    |
| roll_call_number  | integer     | Not null    |
| chamber           | text        | Not null    |
| congress_number   | integer     | Not null, defaults to `119` |
| voted_on          | timestamptz | Nullable    |
| result            | text        | Not null    |
| yes_count         | integer     | Not null, defaults to `0` |
| no_count          | integer     | Not null, defaults to `0` |
| not_voting_count  | integer     | Not null, defaults to `0` |
| vote_title        | text        | Nullable    |
| vote_question     | text        | Nullable    |
| source_url        | text        | Nullable    |

Deployed environments also use:

- `idx_roll_call_summaries_vote_identity` on `(chamber, congress_number, session_number, roll_call_number)` so roll call summaries stay idempotent across chambers and Congresses.

### member_voting_record

| Column            | Type        | Constraints |
| ----------------- | ----------- | ----------- |
| id                | serial      | Primary key |
| legislationNumber | integer     | Nullable    |
| legislation_type  | text        | Nullable    |
| session_number    | integer     | Nullable    |
| roll_call_number  | integer     | Nullable    |
| chamber           | text        | Not null    |
| congress_number   | integer     | Not null, defaults to `119` |
| voted_on          | timestamptz | Nullable    |
| vote              | text        | Not null    |
| member_id         | text        | Not null    |

Deployed environments also use:

- `idx_member_voting_record_vote_identity` on `(member_id, chamber, congress_number, session_number, roll_call_number)` so vote sync stays idempotent across chambers and Congresses.

### senate_vote_ingestion

Senate sync marks a roll call complete only after its summary, member positions, and eligible notification rows have been saved. Its primary key is `(congress_number, session_number, roll_call_number)`. The `completed_at` and `source_modified_at` fields support retries and source corrections.

### user_vote_notification_progress

Delivery cursors are keyed by `(user_id, chamber, congress_number)`, with `last_notified_session_number`, `last_notified_roll_call_number`, and `updated_at`. Migration preserves existing complete House cursors from `users`. This table is server-managed and inaccessible to browser roles.

### legislative_feed_snapshots

Server-only snapshots store `id`, `signing_key`, `payload`, and `expires_at`. Signed pagination cursors retain a frozen feed order for 30 minutes. The backend role needs SELECT, INSERT, and DELETE access; browser roles must not read signing keys. Expired snapshots are reclaimed when a new snapshot is saved.

### vote_notification_outbox

| Column             | Type        | Constraints |
| ------------------ | ----------- | ----------- |
| id                 | uuid        | Primary key, defaults to `gen_random_uuid()` |
| sync_run_id        | uuid        | Not null    |
| member_id          | text        | Not null    |
| chamber            | text        | Not null, defaults to `House` |
| congress_number    | integer     | Not null, defaults to `119` |
| legislation_type   | text        | Not null    |
| legislation_number | integer     | Not null    |
| session_number     | integer     | Not null    |
| roll_call_number   | integer     | Not null    |
| voted_on           | timestamptz | Nullable    |
| vote               | text        | Not null    |
| created_at         | timestamptz | Not null, defaults to `now()` |
| processed_at       | timestamptz | Nullable    |
| attempt_count      | integer     | Not null, defaults to `0` |
| last_error         | text        | Nullable    |

Deployed environments also use:

- `idx_vote_notification_outbox_sync_member_roll_call` on `(sync_run_id, member_id, chamber, congress_number, session_number, roll_call_number)` so overlapping chamber and Congress roll-call numbers remain separate within each sync run.
- `idx_vote_notification_outbox_pending_lookup` on `(processed_at, created_at, sync_run_id, member_id)` so the notification sender can load pending work efficiently.

### interactions

| Column       | Type    | Constraints                                                   |
| ------------ | ------- | ------------------------------------------------------------- |
| id           | serial  | Primary key                                                   |
| stance       | text    | Nullable; clearing a response preserves its interaction/comments |
| user_comment | text    | Nullable                                                      |
| user_id      | integer | Not null, foreign key to `users(id)` with `ON DELETE CASCADE` |
| rep_bioguide_id | text | Not null, foreign key to `reps(bioguideId)` |
| member_vote_id | integer | Nullable, foreign key to `member_voting_record(id)` with `ON DELETE SET NULL` |
| bill_id      | integer | Not null, foreign key to `bills(id)` with `ON DELETE CASCADE` |

## Notification Sync And Delivery

Production vote notifications are driven by Supabase Edge Functions:

- `sync-votes` imports new House vote data, upserts roll call and bill summary data, and queues notification work in `vote_notification_outbox`.
- `sync-senate-votes` imports Senate.gov votes using the reviewed Congress 119 LIS-to-Bioguide crosswalk. Each invocation selects up to 12 missing roll calls plus recent-vote rechecks; one batch does not establish full historical coverage.
- `send-vote-notifications` combines eligible House and Senate updates into a user's digest, sends through Resend, and advances chamber/Congress-specific progress after successful delivery. Matching Senate positions can share an email line. Missing usable summaries hold the digest; a compact official bill title can serve as fallback.
- `sync-reps` refreshes the current House and Senate roster from Congress.gov, preserves historical representatives, and marks departed members inactive. The `sync-reps-monthly` cron invokes it at 08:00 UTC on the first day of each month.

The notification functions require these Supabase function secrets:

- `CONGRESS_API_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `APP_ORIGIN`
- `OPENAI_API_KEY` for generating missing quick summaries; `OPENAI_MODEL` is an optional override.

Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Scheduled requests use Vault entries `project_url` and `edge_function_service_jwt`. Keep JWT verification enabled.

Notification eligibility uses the vote date, not the ingestion date. House votes retain the inclusive September 15, 2026 midnight New York cutoff. Senate votes qualify only **after October 22**, starting **October 23, 2026 at 00:00 America/New_York** (`2026-10-23T04:00:00.000Z`). Historical Senate votes remain available to the feed but are excluded from notification queue creation, backlog seeding, and sender selection. This cutoff does not cap future accumulated eligible votes.

The release defines Senate sync every 15 minutes and a combined daily sender at `10:30 UTC` (06:30 New York daylight time / 05:30 standard time). Activation follows the rollout checklist; keep legacy send schedules inactive.

Manual function modes use POST and service-role authorization:

| Function | JSON body | Effect |
| --- | --- | --- |
| `send-vote-notifications` | `{"mode":"preview"}` | Read-only digest selection; no email or progress changes |
| `sync-votes` | `{"mode":"backfill-pending-bill-data"}` | Repairs pending-vote bill titles/summaries; no email |
| `send-vote-notifications` | `{"mode":"generate-only"}` | Stores missing AI summaries; no email; model usage may incur costs |

**An empty body on `send-vote-notifications` invokes actual delivery.** Preview is not a test email. Keep keys private. Privileged bill backfill requires a legacy service-role JWT in the Authorization Bearer header. Do not use `replayAttemptId` for routine testing because it changes email idempotency identity.

Use `npx supabase ...` for local Supabase CLI commands in this repo. Production function deployments target the Supabase project ref `ycaldyqnmitdajoguagi`.

## API Endpoints

High-level mounted API groups:

- `GET /districts/...`
- `GET /reps/...`
- `GET /reps/state/:state/senators` returns `{ state, chamber, count, senators }` for the named state, using the full state name returned by the Census geocoder. `senators` contains the current roster rows for that state and may contain fewer than two when a seat is vacant.
- `GET /bills/...`
- `GET /housevotes/...`
- `GET /users/...`
- `PUT /users/me/notifications`
- `GET|POST|PUT|DELETE /interactions/...`

Delegation routes introduced by this release:

| Method and route | Purpose |
| --- | --- |
| `GET /reps/delegation` | Guest delegation from state/district |
| `GET /reps/delegation/feed` | Guest paginated feed |
| `GET /users/me/delegation` | Saved delegation |
| `GET /users/me/delegation/feed` | Signed-in paginated feed using saved location |
| `GET /reps/delegation/bills/:billType/:billNumber` | Guest bill voting folders |
| `GET /users/me/delegation/bills/:billType/:billNumber` | Signed-in bill voting folders |
| `GET /users/me/alignment` | Alignment scoped to chamber, policy, or member |
| `PUT /interactions/stances/batch` | Atomic response update for two exact senator vote links |
| `POST /interactions/:interactionId/comment/contact-drafts/group` | Personalized guides from one approved comment |

Feed requests accept `limit` (1–50, default 5), `chamber` (`All Reps`, `House`, `Senate`), optional `policyArea`, and continuation `cursor`. Guests supply state/district; signed-in routes use saved location. District `0` is valid. Continue using returned `page.nextCursor` while `page.hasMore` is true; offsets are unsupported. Scope changes start a new feed. Invalid cursors return 400, viewer mismatches 403, expired/changed snapshots 409 with refresh instructions, and read failures 503 with retry metadata.

Alignment uses responses linked to exact member votes and separates chamber/Congress/session/roll-call identities. It averages member percentages before rounding the final result. Missing comparisons differ from zero agreement. See the [alignment trace](specs/rep-card-alignment-trace.md) and [pagination verification](specs/legislative-feed-pagination-verification.md).

## Wireframes

https://gemini.google.com/share/b8811c595e88

## How I Use AI

I use AI primarily as a teacher, reviewer, and pair-programming guide, not as a full autopilot code generator.

### Skills I use

The example prompts for the skills used in this repo live in:

- `example-skills/README.md`
- `example-skills/example.teach-me.md`
- `example-skills/example.quickstart-me.md`
- `example-skills/example.correct-me.md`

### What each skill does for me

- `teach-me`
  - My default mode.
  - Gives me step-by-step implementation guidance with checkpoints.
  - Best for learning while I type the code myself.
- `correct-me`
  - Reviews my existing code and reasoning.
  - Best for catching logic mistakes, edge cases, and small fixable issues after I implement.
- `quickstart-me`
  - Generates beginner-first mini tutorials in Markdown.
  - Best for learning a concept from zero before I touch the real codebase.

### My AI usage philosophy

- Most of the time I am following the `teach-me` skill and implementing the changes myself step by step.
- I only let AI generate and implement code when I completely understand the functionality and feel ready to accelerate development.
- Roughly speaking, about 85% of the time I am learning or implementing with guided mentorship, and about 15% of the time I let AI generate and apply code changes directly.
- Even when AI helps more aggressively, I still verify the behavior myself by running the app, checking the database, and testing features end to end.

## VoteFeed (How Merlin Built It)

**Guy R.:**
Merlin, I want to start with the moment before any of this existed. Before the database tables. Before the endpoints. Before you were staring at an API response at 2 a.m. like it personally betrayed you. What was happening that made you say: "I have to build this"?

**Merlin:**
I was watching people argue online about bills they had not read, from lawmakers they could not name, from a district they were not even sure they lived in. And I kept thinking: politics online is like a group chat where everyone is yelling and nobody has the link.

**Guy R.:**
So you built the link.

**Merlin:**
I built the feed. VoteFeed is basically a Twitter or Bluesky-like experience where constituents can interact with their U.S. House representative by sharing opinions on policies up for vote based on what actually happened. Enter your address, get your district, get your rep, see the voting record, then react: approve, disapprove, comment.

**Guy R.:**
This feels like the most modern way to do civic engagement. It is like, "Here's democracy, but also dopamine."

**Merlin:**
Exactly. I am not proud of that part, but I am also not denying it.

**Guy R.:**
Okay, walk me through the version one promise. If I am a user, what do I get on day one?

**Merlin:**
MVP V1 was: any user can enter an address and see a cascading feed of their district's assigned U.S. representative's voting record. Then users can register and log in. And once you are authorized, you can save your address, district, and rep, approve or disapprove of a bill, and leave a comment about why.

**Guy R.:**
So you built the full loop. Identity to district to representative to voting record to interaction.

**Merlin:**
Yeah. It is the full pipeline from "Where do I live?" to "Here is my opinion, respectfully, and with a timestamp."

**Guy R.:**
Let's talk about the APIs, because whenever someone says "I'm just going to pull public information," I hear ominous music in my head. What did you use?

**Merlin:**
For the congressional district from an address, I used the U.S. Census Geocoder API. Then to get the rep, I used the Congress.gov API member list by state and district. And to get voting data, I used the House vote endpoints, including member-by-member votes.

**Guy R.:**
I love how calm that sounded. Because I know what happened behind the scenes was you getting a response shaped like a nested Russian doll.

**Merlin:**
Yes. The hardest part was not the big pieces. It was the glue. What is the canonical ID for a bill? How do I store vote metadata cleanly? What happens when the API rate-limits me? How do I make the feed feel simple while the backend is doing gymnastics?

**Guy R.:**
Let's get into the database. Because there is something deeply funny about taking heated political opinions and turning them into rows.

**Merlin:**
That is exactly what it is. Democracy, but normalized.

**Guy R.:**
Okay, endpoints. Give me the menu.

**Merlin:**
Auth is: register, login, logout, and "me" to return the current user. Users: get my profile, update my saved defaults like address, district, rep. Lookup: get district from address, get rep from state and district. Bills and votes: bill details, overall House vote metadata, and member-by-member votes. Interactions: create an interaction, list interactions for a bill, and delete your own.

**Guy R.:**
That delete endpoint is emotional maturity. Because sometimes you wake up and you are like, "Why did I disapprove this bill at 1:47 a.m. and leave a comment that starts with 'Listen.'"

**Merlin:**
Exactly. That endpoint exists for personal growth.

**Guy R.:**
So V1 works. Now you are looking at V2. What do you want VoteFeed to become?

**Merlin:**
V2 is where it turns into a true product for the public. Filtering the feed by bill interests, showing how other constituents in your district are voting and commenting, adding more bill info like vote date and bill type, adding rep info like photo and links, third-party login, notifications when there are new votes from your rep, and language moderation so the comments stay appropriate.

**Guy R.:**
That last part is where you realize you did not just build an app. You built a place. And places need rules.

**Merlin:**
Yeah. When people care, they show up loud. And I want it to stay grounded in the bill, not just vibes.

**Guy R.:**
Okay, final question. If you had to describe VoteFeed in one sentence, what is it?

**Merlin:**
VoteFeed is where you stop guessing what your rep did and start responding to what they actually did.

**Guy R.:**
Merlin Valdez, founder of VoteFeed.

Copyright (c) 2025 Merlin Valdez  
All rights reserved.

No permission is granted to use, copy, modify, or distribute this software.
