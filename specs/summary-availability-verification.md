# Summary availability behavior — November 12, 2026

Implemented all three requested behaviors and deployed them to production.

- Feed and bill details share a disabled official-summary toggle when official
  text is absent. Its hover title and accessible name are
  `Official summary not yet available`. A wrapper provides hover text around the
  disabled button. Available summaries retain the existing toggle behavior.
- Bill details default to AI when official text is empty and load AI automatically
  if it is not cached. AI failure offers Retry without falsely claiming that an
  official fallback is being shown.
- Daily sync retries official summaries, then generates AI from newly published
  or revised official text. A database trigger invalidates stale AI and marks
  durable refresh work for every ingestion path. Failed generation stays pending.
  A dedicated flag excludes the 4,359 historical bills without AI from this new
  publication queue. Bounded batches, timeouts, and daily rotation limit work.
- Notification generation shares the existing prompt/model with daily sync. Both
  workers guard cache writes against changed official text. On-demand generation
  already has the same source guard. Successful writes clear the pending flag.

## Verification

- 117 Node tests passed with all PostgreSQL flags enabled; zero failures/skips.
- 18 Deno notification tests passed. The shared generation/refresh modules and
  notification function passed Deno type checking. The older full sync-function
  type-check issues documented in the previous hotfix remain outside this change.
- Frontend production build and `git diff --check` passed.
- Review caught and resolved a stale-source race in the notification worker.
- Real browser checks covered cached AI, missing AI, AI failure and successful
  retry, and disabled official controls. Production H.Res. 1650 opened directly
  to AI with its official control disabled. The live New York district 13 feed
  showed both unpublished-resolution toggles disabled and published-bill toggles
  enabled, alongside regenerated AI text.
- Production repair request 4504 returned HTTP 200 with AI `generatedCount: 2`,
  `failedCount: 0`, `deferredCount: 0`. H.R. 9612 and H.R. 3978 now have fresh AI
  derived from their official summaries and their pending flags are false.

## Production rollout

- Frontend: Vercel `dpl_8sryTpwWBRGU1bjuPaGToqHiBTC4`, READY, production aliases
  including `www.votefeed.org`.
- Database: migration `20261112180440_refresh_ai_on_official_summary.sql` applied;
  local migration version matches the hosted migration history.
- `send-vote-notifications`: version 20 ACTIVE, JWT verification enabled.
- `sync-votes`: version 23 ACTIVE, JWT verification enabled.

The daily cron schedule was preserved. Existing unpublished official summaries
stay unavailable until Congress publishes them. Source changes are picked up by
the existing ingestion paths; the daily missing-summary pass covers delayed first
publication independently of vote dates.
