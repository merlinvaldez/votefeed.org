# Official summary production hotfix — November 12, 2026

## Diagnosis

The production feed returned `officialHtml: null` for H.R. 9612 and H.R. 3978,
despite Congress publishing summaries on November 5 and November 4 respectively.
Their November 10 and November 9 votes triggered House ingestion, which inserted
title-only bill rows and then requested bulk summaries updated since the vote date.
That cutoff excluded both summaries. The renderer correctly reported the empty data.

An audit of every empty production bill summary found 26 measures. Direct Congress
API lookups found published summaries for those two bills; the other 24 returned
empty summary lists. No generated or title-derived text was substituted for official HTML.

## Changes and production repair

- Restored the exact Congress API HTML for bill IDs 18559 and 18560, updating only
  empty summaries with matching bill identities and official Congress URLs.
- Daily `sync-votes` now independently retries empty official summaries, including
  Senate measures and measures outside pending notification eligibility.
- Four workers process at most 20 candidates per invocation. Daily batch rotation
  prevents unpublished measures from starving later candidates. All candidate IDs
  are read before writes so repaired rows cannot shift pagination.
- Added service-role-only `backfill-official-summaries` mode for repairs without
  ingesting votes or touching notification queues. JWT verification remains enabled.
- Deployed production `sync-votes` version 21. The prior deployed version 20 matched
  repository HEAD before this change. Existing daily cron remains enabled at `0 9 * * *`.

## Verification

- 25 targeted Node tests passed across official-summary-backfill, house-bill-links,
  feed-public-comments, feed-summaries, delegation-feed-client, and legislative-card.
- New tests cover daily repair, published/unpublished summaries, upstream failure
  isolation, identity checks, handler authorization, actual lookup/write integration,
  and bounded rotating batches. Each new behavior was first observed failing.
- Production repair invocation (pg_net request 4502) returned HTTP 200:
  `checkedCount: 4`, `deferredCount: 20`, `repairedCount: 0`,
  `unavailableCount: 4`, `failures: []` after the data repair.
- Live production feeds for New York districts 13 and 14 returned official HTML
  lengths 1061 and 1543 for H.R. 9612 and H.R. 3978. Existing H.R. 2347's summary
  remained available. H.Res. 1650 and H.Res. 1655 remain empty at the official source.
- An unauthenticated repair request returned HTTP 401.
- `git diff --check` passed.

The full Deno type check is not clean: unchanged HEAD already reports 28 errors
with the currently resolved Supabase SDK, including its `ReturnType<typeof
createClient>` alias and pagination annotations. The new helper calls encounter
that same existing alias incompatibility. Runtime handler tests and the deployed
function succeeded. The rendered-card test also emitted a Vite dependency-scan
shutdown warning while passing; no frontend source changed in this hotfix.

Refresh the feed to load repaired data. Remaining genuinely unpublished summaries
retain their unavailable state and are retried by the daily sync.
