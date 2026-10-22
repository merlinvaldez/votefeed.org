# VoteFeed production rollout checklist

Prepared October 22, 2026. We will follow this together, one checkpoint at a time. All production commands below are for Merlin to run manually. Creating this planning document is the only authorized file change in this task.

## Scope

Branch: `37-add-senate-to-feed`, HEAD `6936c165fecc073920b7437bfbcb4fe9ca64321e`. Compared with local `main` at merge base `392b3f48ba76a8cb3de9e2c93e6a9796c1674f24`; working tree was clean before this document. Remote main freshness has not been established.

Release includes Senate ingestion, House/Senate vote identity, delegation feed snapshots and pagination, bill folders and summaries, alignment, shared contact flows, nullable interaction responses, and combined email digests.

Read-only production discovery confirmed:

* Supabase production reference: `ycaldyqnmitdajoguagi`.
* Migration ledger contains only `20260915161114_schedule_monthly_rep_sync`.
* Vote tables and outbox lack chamber/Congress columns. Snapshot, Senate ingestion, and notification progress tables are absent. `interactions.stance` is still required; `member_vote_id` is absent.
* Active jobs: `sync-votes-daily` (`0 9 * * *`), `sync-reps-monthly` (`0 8 1 * *`), and two legacy senders named below.
* Vault secret names `project_url` and `edge_function_service_jwt` exist; their values were not inspected.
* Vercel frontend: `votefeed-org-5n1c`, ID `prj_Kt3uLNnhcM8v4pVghJy0cgZ9QrN8`; custom domains include `votefeed.org` and `www.votefeed.org`. Latest returned deployment was READY with no production target; this does not establish the active production revision.
* Client configuration references backend `votefeed-org-backend`, related project ID `prj_7JHlqzqpw2F5ZgeL0UdVQMKekiE5`. Backend production URL and deployed revision still need confirmation.

## Rollout Order

Tests and browser acceptance → backup and inventory → pause background jobs → reconcile/apply schema → deploy functions with schedules still paused → verify roster and ingest Senate data → preview notifications → deploy backend then frontend → app acceptance → restore ingestion schedules → enable daily digest after reviewing recipients and backlog.

Do not run an unrestricted `supabase db push`: two migrations activate schedules and one queues historical emails. Apply and verify individual files in the controlled sequence below. Do not run `server/src/db/schema.sql` against production.

- [x] **1. Establish the release candidate and pass local checks.**
  **How to do it:** In PowerShell at `C:\Users\merli\Desktop\repos\voteFeed`, run:
  ```powershell
  git branch --show-current
  git rev-parse HEAD
  & 'C:\Program Files\nodejs\npm.cmd' run test:all
  ```
  **How to verify it:** Branch and commit match Scope; automated suites, lint, and build finish successfully without skipped database suites. This runner does not validate the Supabase migration chain.
  **Verified:** Codex ran `npm run test:all` after fixing the migration filename in `tests/batch-stances.test.mjs`: 97 Node tests passed, 17 Deno tests passed, client lint and production build passed; zero skipped tests. The tested candidate includes that uncommitted one-line fix on top of the Scope HEAD. Existing Vite NODE_ENV warning did not fail the build.

- [x] **2. Prove preview UI behavior before touching production.**
  **How to do it:** Open the branch preview. Enter a real address, then sign in with a test account. Switch All Reps/House/Senate, load additional feed pages, open a bill, toggle its simplified summary, and switch all three bill folders. Submit a response and comment, clear the response, and reload. Exercise the shared contact draft flow for both senators.
  **How to verify it:** Cards match the selected chamber; pagination has no repeated or missing cards; simplified text differs from official text and persists across all bill folders; clearing a response preserves its comment; alignment refreshes; contact drafts target the chosen members. Record preview URL and results. Stop for any regression.
  **Verification source:** Merlin confirmed these preview checks were already completed. Codex did not independently repeat the browser checks; preview URL was not recorded in this conversation.

## Data Safety Checks

- [x] **3. Record production revisions, backup, and job inventory.**
  **Read-only inventory collected:** 23 users, 298 interactions, 57,185 pending outbox rows. Migration ledger still contains only `20260915161114`. Jobs 1, 6, 7 and 8 remain active with the schedules recorded in Scope. Both legacy member-vote unique indexes (`idx_member_voting_record_member_roll_call` and `member_voting_record_member_roll_call_uidx`) exist; the repair migration explicitly drops both. Existing summary/outbox indexes match the old schema.
  **Verified production deployments:** Frontend `dpl_7BVg26wCn2U8hpCDaQQ6uXnZ4RRS`, aliases `votefeed.org` and `www.votefeed.org`; backend `dpl_GUWvZgjAivUXVJJgHTLqcmsQwFLQ`, alias `votefeed-org-rgvh.vercel.app`. Both are READY, target production, with Git commit `87b2e968db3f9c152ee003f6193603b0399807ec` on `main`. These are the recorded rollback candidates.
  **Recovery point:** Merlin confirmed a restore point is available for today, October 22, 2026; exact timestamp was not supplied. Restoration was not performed or tested.
  **Build settings verified in the live Vercel dashboard:** Frontend root `client`, Vite preset, Build Command override `npm run build`, Output Directory override `/dist`. Backend root `server`, Other preset, Build Command and Output Directory blank with overrides disabled. Both use Node `24.x` and include files outside the root directory. Connector responses omitted these fields; read-only browser inspection established them. No settings were changed.
  **Candidate update:** Local HEAD is now `b3d29f6e6285cc7816fda21946b5f7b523861f7a`, including the tested filename fix and planning document. Vercel shows its READY frontend branch preview at `https://votefeed-org-5n1c-pkwoajgu3-merlin-projects.vercel.app`.
  **How to do it:** In Vercel, open each project → Deployments → current Production deployment; record deployment IDs, Git commit, domains, root directory, build command, and output directory. In Supabase project `ycaldyqnmitdajoguagi` → Database → Backups, confirm an available recovery point and restore procedure. In SQL Editor run:
  ```sql
  SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;
  SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;
  SELECT tablename, indexname, indexdef FROM pg_indexes
  WHERE schemaname='public'
    AND tablename IN ('roll_call_summaries','member_voting_record','vote_notification_outbox')
  ORDER BY tablename,indexname;
  SELECT count(*) AS users FROM public.users;
  SELECT count(*) AS interactions FROM public.interactions;
  SELECT count(*) AS pending FROM public.vote_notification_outbox WHERE processed_at IS NULL;
  ```
  **How to verify it:** Save counts, indexes, migration versions, schedules, recovery point, and both Vercel production IDs. Investigate duplicate or unexpected indexes before migration; the migration drops known old names only. Do not share credentials or user records in chat.

- [x] **4. Pause existing sync and email jobs during the cutover.**
  **How to do it:** In production SQL Editor run:
  ```sql
  SELECT cron.alter_job(jobid, active := false)
  FROM cron.job WHERE jobname IN (
    'sync-votes-daily','sync-reps-monthly','sync-senate-votes-quarter-hour',
    'send-vote-notifications-0530-0555-et',
    'send-vote-notifications-0600-0625-et',
    'send-vote-notifications-0930-0955-utc',
    'send-vote-notifications-1000-utc',
    'send-vote-notifications-daily-1030-utc');
  SELECT jobid,jobname,schedule,active FROM cron.job ORDER BY jobid;
  SELECT jobid,status,start_time,end_time FROM cron.job_run_details
  ORDER BY start_time DESC LIMIT 20;
  ```
  **How to verify it:** Relevant jobs are inactive. In Edge Functions → Logs, wait for any already-started sync/send invocations to finish before schema work. Pausing a schedule does not cancel an in-flight request. Save the original active states from step 3.
  **Pause confirmed by Merlin:** Jobs 1 (`sync-votes-daily`), 6 (`send-vote-notifications-0530-0555-et`), 7 (`send-vote-notifications-0600-0625-et`), and 8 (`sync-reps-monthly`) all show `active=false`. Read-only cron history shows the latest dispatch completed at 10:25 UTC; function request logs show its HTTP 200 response at 10:25:02 UTC and no later requests in the returned latest entries, several hours before this checkpoint. No recent scheduled invocation remains indicated by these logs.

## Supabase Production Changes

- [x] **5. Apply schema migrations one file at a time while schedules remain paused.**
  **How to do it:** Open each following file locally, copy its full contents into production SQL Editor, and run it once, in this order. If an object already exists, stop and reconcile its definition rather than rerunning or marking it applied blindly.

  1. `supabase/migrations/20260928232928_reactivate_current_at_large_house_members.sql`
  2. `supabase/migrations/20260929223545_add_chamber_to_votes.sql`
  3. `supabase/migrations/20260930000652_senate_vote_ingestion_repair.sql`
  4. `supabase/migrations/20261009154322_link_alignment_stances_to_member_votes.sql`
  5. `supabase/migrations/20261014192544_legislative_feed_snapshots.sql`
  6. `supabase/migrations/20261019144414_add_vote_notification_outbox_event_identity.sql`
  7. `supabase/migrations/20261019154303_combined_daily_vote_notification_digest.sql`
  8. `supabase/migrations/20261020171102_nullable_interaction_stance.sql`

  **Migration 1 applied and verified by Merlin:** All 12 specified at-large House members returned district 0, `is_current_member=true`, and `last_seen_at=2026-10-22 14:55:52.148998+00`. Ledger reconciliation is still pending under step 6. Remaining migrations are not yet confirmed applied.
  **Migration 2 applied and verified:** Merlin returned both expected chamber-aware unique indexes. Codex read-only production verification confirmed 573 roll-call summaries and 247,374 member-vote records, all labeled House; both chamber columns have `is_nullable=NO`. Ledger reconciliation remains pending. Migration 3 and later are not yet confirmed applied.

  Run file 7 inside an explicit transaction: prepend `BEGIN;`, then append the following pause SQL and `COMMIT;` after the complete file contents. This keeps its newly created sender inactive when the transaction commits:
  ```sql
  SELECT cron.alter_job(jobid, active := false)
  FROM cron.job WHERE jobname='send-vote-notifications-daily-1030-utc';
  COMMIT;
  ```
  File 7 does not remove production's differently named legacy jobs; keep those paused. Verify every sender remains inactive before continuing.

  **How to verify it:** Each file succeeds once. Run:
  ```sql
  SELECT table_name,column_name,is_nullable FROM information_schema.columns
  WHERE table_schema='public' AND table_name IN (
    'roll_call_summaries','member_voting_record','interactions',
    'vote_notification_outbox','senate_vote_ingestion',
    'legislative_feed_snapshots','user_vote_notification_progress')
  ORDER BY table_name,ordinal_position;
  SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public'
  AND tablename IN ('roll_call_summaries','member_voting_record','vote_notification_outbox');
  SELECT count(*) AS missing_preserved_house_cursors FROM public.users u
  LEFT JOIN public.user_vote_notification_progress p
    ON p.user_id=u.id AND p.chamber='House' AND p.congress_number=119
  WHERE u.last_notified_session_number IS NOT NULL
    AND u.last_notified_roll_call_number IS NOT NULL
    AND (p.user_id IS NULL OR p.last_notified_session_number IS DISTINCT FROM u.last_notified_session_number
      OR p.last_notified_roll_call_number IS DISTINCT FROM u.last_notified_roll_call_number);
  ```
  Expect chamber/Congress columns and final vote-identity indexes, all three new tables, nullable stance, member-vote foreign key, and zero missing House cursors. Compare original counts; investigate unintended loss. Existing votes are labeled House and Congress 119, so confirm this matches stored historical data before applying files 2–3.

- [x] **6. Record successfully applied migrations in the ledger.**
  **How to do it:** After each file's effects are verified, use PowerShell in the repository. First link the intended project, then repair only verified versions (replace the example version with the timestamp of that verified file):
  ```powershell
  npx.cmd supabase link --project-ref ycaldyqnmitdajoguagi
  npx.cmd supabase migration repair 20260928232928 --status applied --linked
  npx.cmd supabase migration list --linked
  ```
  **How to verify it:** Only actually applied files are recorded remotely. Leave the Senate schedule and backlog versions unrecorded until their later steps. Ledger repair records history; it does not execute SQL. See [migration documentation](https://supabase.com/docs/guides/deployment/database-migrations).

- [ ] **7. Confirm function secrets and deploy all four changed functions.**
  **Deployment verification:** Merlin reported all four deploy commands completed. Live metadata confirms ACTIVE `sync-reps` v7, `sync-votes` v17, `sync-senate-votes` v1, and `send-vote-notifications` v16; all have `verify_jwt=true` and import maps. Required secret names exist. Values/provider validity remain to be proven by runtime checks; APP_ORIGIN and sender-domain confirmation remain outstanding. All five cron jobs were rechecked and remain inactive. Keep this item open until remaining configuration checks pass.
  **How to do it:** Supabase → Edge Functions → Secrets: confirm `CONGRESS_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `APP_ORIGIN`, and `OPENAI_API_KEY`; preserve the intended `OPENAI_MODEL` override if used. Confirm sender domain in Resend and APP_ORIGIN against the frontend production domain. Built-in Supabase URL/service-role credentials are supplied by the platform. Vault `project_url` and `edge_function_service_jwt` must target this project and authorize scheduled requests. Do not paste values into chat. Run:
  ```powershell
  npx.cmd supabase functions deploy sync-reps --project-ref ycaldyqnmitdajoguagi
  npx.cmd supabase functions deploy sync-votes --project-ref ycaldyqnmitdajoguagi
  npx.cmd supabase functions deploy sync-senate-votes --project-ref ycaldyqnmitdajoguagi
  npx.cmd supabase functions deploy send-vote-notifications --project-ref ycaldyqnmitdajoguagi
  ```
  **How to verify it:** All four deployments succeed. Confirm JWT verification remains enabled, including the newly added Senate function, whose config block is absent locally. No `--no-verify-jwt`. Keep all schedules paused. See [function deployment documentation](https://supabase.com/docs/guides/functions/deploy).

- [x] **8. Refresh the roster and ingest Senate votes without sending emails.**
  **Roster refresh verified by Merlin:** sync-reps returned `currentHouseMemberCount=439`, `currentSenatorCount=100`, `deactivatedMemberCount=0`, `syncedAt=2026-10-22T15:09:30.864Z`. Senate ingestion remains pending.
  **Initial Senate ingestion verified:** Run `fd64d6c2-855d-4e49-8ec4-b32308cd3bc4` saved 12 session-2 and 2 session-1 roll calls with no failures and zero queued notifications. Live read-only verification confirmed 14 completion markers, 1,400 Senate member positions, zero member-count mismatches, zero Senate outbox rows, unchanged 57,185 pending House rows, and zero active cron jobs. This verifies initial ingestion, not full historical coverage; remaining history will require more batches.
  **How to do it:** In Edge Functions → `sync-reps` → Test, POST `{}` using the authorized service-role request option. Then do the same for `sync-senate-votes`. These requests write data; run them manually only after step 7.
  **How to verify it:** Both return successful responses and logs show no missing-secret, authorization, parse, or constraint failures. Run:
  ```sql
  SELECT chamber,count(*) FROM public.reps WHERE is_current_member GROUP BY chamber;
  SELECT chamber,count(*) FROM public.member_voting_record GROUP BY chamber;
  SELECT count(*) AS completed_roll_calls FROM public.senate_vote_ingestion;
  SELECT i.congress_number,i.session_number,i.roll_call_number,i.member_count,
    count(m.id) AS stored_members
  FROM public.senate_vote_ingestion i
  LEFT JOIN public.member_voting_record m ON m.chamber='Senate'
    AND m.congress_number=i.congress_number AND m.session_number=i.session_number
    AND m.roll_call_number=i.roll_call_number
  GROUP BY i.congress_number,i.session_number,i.roll_call_number,i.member_count
  HAVING count(m.id)<>i.member_count;
  ```
  Expect current House/Senate roster, Senate vote rows and completion markers, and zero member-count mismatches. Vacant seats can reduce the roster; do not force a count of 100.

- [x] **9. Review and queue the intended Senate backlog, then preview delivery.**
  **Seed applied and verified by Merlin:** `senate_rows=0`, `excluded_senate_rows=0`, `pending=57185`. The revised October 23 New York cutoff queued no historical Senate votes. Seed ledger registration and sender preview remain pending.
  **Seed ledger and preview verified:** Live ledger includes `20261019154813`. Merlin's preview returned the correct Senate cutoff `2026-10-23T04:00:00.000Z`, 4,695 loaded/deliverable House rows, 21 selected digests each containing one House vote and zero Senate votes. All 21 digests are blocked by missing bill summaries for the September 16 vote. Read-only investigation found S.2403 absent from public.bills. Pending count remains 57,185 and active cron count remains zero. Keep step 9 open pending bill-data backfill and a clean preview; do not resume sending.
  **Blocker resolved:** At Merlin's explicit request to implement the backfill, Codex invoked production sync-votes with `mode=backfill-pending-bill-data` using the authenticated CLI fallback (connector has no invocation tool). Ten bills processed, nine changed, ten official summaries available, no failures, no remaining bill batches. A subsequent preview returned 21 unblocked digests, each with one House vote and zero Senate votes; each currently uses its official bill title fallback. Senate cutoff remains `2026-10-23T04:00:00.000Z`. No delivery-mode invocation or schedule activation was performed. Earlier missing-summary preview above is superseded by this successful preview.
  **How to do it:** Read `20261019154813_seed_senate_vote_notification_backlog.sql` together before running it. Its Senate-only cutoff is October 23, 2026 at midnight America/New_York (`2026-10-23T04:00:00.000Z`), Congress 119: votes on October 22 or earlier must not be emailed. House retains its September 15 cutoff. The seed was changed before production application, as requested; do not rerun it in environments where it is already recorded as applied. With senders paused, run that file in production SQL Editor once and record its version via step 6. In Edge Functions → `send-vote-notifications` → Test, POST `{"mode":"preview"}` using the service-role authorization option. Confirm `senateCutoffInclusive` matches the October 23 timestamp and preview digests contain no earlier Senate votes. Deploy the updated sender and Senate sync before enabling any schedule.
  **How to verify it:** Response says `mode: preview` and reports `loadedPendingVoteCount`, `deliverablePendingVoteCount`, `digestCount`, and `digests`. Review recipients, dates, chamber grouping and enabled users privately. Preview must not send mail or advance delivery cursors. Save before/after pending counts and progress rows to confirm. Stop if the backlog size or recipients are unexpected. Never use `replayAttemptId` for routine testing; it changes delivery identity.

## Vercel Production Changes

- [x] **10. Confirm frontend/backend environment routing and snapshot permissions.**
  **Verified live by Codex:** Production Vercel frontend `VITE_API_URL` is `https://votefeed-org-rgvh.vercel.app`; the currently served frontend bundle `/assets/index-Cb1VSmn7.js` contains that same API base. Backend Production DATABASE_URL identifies Supabase project `ycaldyqnmitdajoguagi` on the transaction pooler (port 6543), database `postgres`, database role `postgres`. Credentials were not printed or saved. Vercel connector env reads returned 403 and CLI had no login; the existing signed-in dashboard provided the authorized settings inspection. Revealed fields were masked again.
  **Backend-role verification:** In a read-only transaction using `SET LOCAL ROLE postgres`, snapshot SELECT/INSERT/DELETE privileges all returned true, `row_security_active` returned false, and SELECT count succeeded (zero existing snapshots). No permission change was needed. This verifies the configured role's access, not a new snapshot write through the unreleased backend. Existing production backend GET `/reps/district/New%20York/13` returned HTTP 200. End-to-end snapshot save/continuation remains a post-deploy step 12 check. Zero active cron jobs confirmed afterward; no deployments, env changes or emails occurred.
  **How to do it:** Vercel → frontend project → Settings → Environment Variables → Production: confirm the related-project backend resolves to `votefeed-org-backend`, or set `VITE_API_URL` (fallback `VITE_API_BASE`) to the backend Production domain recorded in step 3. Backend → Settings → Environment Variables → Production: confirm `DATABASE_URL` points to the intended Supabase production database and preserve existing Clerk, Congress and OpenAI credentials. No new test flags belong in production.
  **How to verify it:** With the same database role used by backend DATABASE_URL, run privately:
  ```sql
  SELECT current_user,
    has_table_privilege(current_user,'public.legislative_feed_snapshots','SELECT') AS can_read,
    has_table_privilege(current_user,'public.legislative_feed_snapshots','INSERT') AS can_insert,
    has_table_privilege(current_user,'public.legislative_feed_snapshots','DELETE') AS can_clean;
  ```
  All three permissions must be true and RLS must permit this trusted server role. Do not grant browser roles access to snapshot signing keys. If the role lacks access, stop for a tailored permission migration. `ALIGNMENT_TEST_POSTGRES`, `BATCH_STANCES_TEST_POSTGRES`, `DELEGATION_TEST_POSTGRES`, and `CARD_PREVIEW_PORT` are test tools, not production variables.

- [ ] **11. Merge the reviewed release through GitHub and verify both production deployments.**
  **Chosen release method:** GitHub PR merge into `main`. Commit/push the reviewed code and documentation first, confirm both latest Vercel preview checks pass, then merge `37-add-senate-to-feed` into `main` through GitHub. This can trigger frontend/backend builds concurrently; do not assume backend-first ordering. Keep jobs paused and wait for both production deployments to become READY before step 12. Record the actual merged commit on both deployments. Supabase migrations and function deployments are separate from this GitHub merge and have their own verification above.
  **Alternative only if sequencing is needed:** Promote the reviewed backend deployment first and frontend second through Vercel, then keep main aligned with the release. Environment changes require a new build before promotion.
  **How to verify it:** Both production deployments are READY, show the intended commit, and serve the recorded production domains. Browser Network requests target the production backend. Preserve the previous deployment IDs for rollback.

## Post-Deploy Verification

- [ ] **12. Verify production feed, sessions, comments and bill summaries.**
  **How to do it:** Open `https://votefeed.org` in a private browser. Repeat step 2 signed out where supported and then with the test account signed in. Refresh a bill deep link directly. Check browser Network responses for `/reps/delegation/feed` while changing chambers and loading another page.
  **How to verify it:** No 503 feed failures or auth loops; backend snapshot save/read/cleanup works; feed continuation and filters work; direct links load; comments survive response clearing; summaries change visibly and persist across folders; current representatives and senators match the saved address. Inspect backend logs for DB permission or missing-column errors.

- [ ] **13. Install and enable ingestion schedules after verification.**
  **How to do it:** Run `supabase/migrations/20260930000953_schedule_senate_vote_sync.sql` in SQL Editor and record version `20260930000953` through step 6. Restore the original House and roster jobs:
  ```sql
  SELECT cron.alter_job(jobid,active := true) FROM cron.job
  WHERE jobname IN ('sync-votes-daily','sync-reps-monthly');
  SELECT jobid,jobname,schedule,active FROM cron.job ORDER BY jobid;
  ```
  **How to verify it:** Senate sync is active on `*/15 * * * *`, House on `0 9 * * *`, and roster on `0 8 1 * *`. Confirm the next Senate invocation reaches the function and returns successfully in Edge Function logs; a successful cron HTTP enqueue alone does not prove ingestion succeeded.

- [ ] **14. Enable only the reviewed combined daily digest.**
  **How to do it:** After preview and production acceptance, run:
  ```sql
  SELECT cron.alter_job(jobid,active := false) FROM cron.job
  WHERE jobname IN ('send-vote-notifications-0530-0555-et',
    'send-vote-notifications-0600-0625-et',
    'send-vote-notifications-0930-0955-utc',
    'send-vote-notifications-1000-utc');
  SELECT cron.alter_job(jobid,active := true) FROM cron.job
  WHERE jobname='send-vote-notifications-daily-1030-utc';
  SELECT jobname,schedule,active FROM cron.job
  WHERE jobname LIKE 'send-vote-notifications%';
  ```
  **How to verify it:** Exactly one sender is active: daily `30 10 * * *` UTC (6:30 a.m. New York on October 22; 5:30 a.m. during standard time). Observe the first scheduled send in function logs and Resend delivery events. Confirm the test account receives one combined digest with correct links and chamber content. Compare outbox pending/error counts and per-chamber progress after sending; investigate deferred or failed users before retrying. Enabling this job authorizes real subscriber emails.

## Risks / Blockers

* Live cron name mismatch is confirmed. The digest migration alone leaves both legacy production senders active. Steps 4 and 14 address this explicitly.
* Migration files change indexes and backfill House/Congress labels. Confirm existing data fits those assumptions and plan a maintenance window; rollback is not simply redeploying old application code.
* Manual SQL execution requires ledger reconciliation. Do not repair an unexecuted or partially applied migration.
* Senate notification eligibility starts October 23, 2026 at midnight New York time. Shared code enforces this at queue creation and digest selection; sender queries exclude older Senate rows before pagination. Old Senate queue rows may remain stored but are not eligible for delivery. Historical Senate feed ingestion is unchanged. This does not cap email size if many eligible future votes accumulate while sending is paused.
* Backend production role, active deployment revisions, function secret validity, and backup recoverability remain unverified.
* Local main was used as the comparison base. Refresh and re-evaluate scope if remote main or the release candidate changes.
* Prior memory reported a simplified-summary UI regression. Its present status must be established by step 2, regardless of build results.
* No branch-specific Storage or Supabase Auth setting change was established. The app uses Clerk; verify its existing production sessions rather than adding speculative Supabase Auth redirects.

- [ ] **15. Record rollback and final evidence.**
  **How to do it:** Save test output, preview results, migration ledger, deployment IDs, job schedules, and first delivery evidence beside this checklist. If delivery is wrong, pause the daily sender using the step 4 SQL before investigating. For app regression, Vercel → Deployments → previous known-good production deployment → Rollback, after checking compatibility with the upgraded schema.
  **How to verify it:** The chosen deployment serves successfully; sender remains paused during any email incident; user comments and progress remain intact. Do not drop new tables/columns or restore a backup automatically: restoration can discard new user activity and needs its own recovery decision.

## Current checkpoint: step 11, reviewed backend/frontend production deployment

Steps 1–6 and 8–10 are complete. Step 7 sender-domain/APP_ORIGIN checks remain open before email enablement. Step 10 verified live production API routing, correct database project/role, and snapshot privileges without configuration changes. Next review the current branch release revision and matching Vercel preview deployments before performing step 11; do not promote automatically under this step-10 authorization. Historical Senate ingestion remains incomplete; Senate schedule `20260930000953` is still pending. All schedules remain paused. Do not run db push or enable delivery yet.
