# Development hotfix parity — November 12, 2026

## Active development deployments

- Frontend: https://votefeed-org-5n1c-git-42-add-elections-tab-merlin-projects.vercel.app
  → Vercel `dpl_GoKX2grR6QhxGEKvw8sbZzgL1qoT`, READY, preview.
- Backend: https://votefeed-org-backend-git-42-add-elections-tab-merlin-projects.vercel.app
  → Vercel `dpl_9mQyNYk6Gt4U3BfWiMLt7NsghZdw`, READY, preview.
- Supabase: `votefeed-dev`, project `kddqnmenstoilnzwajnb`, using the Supabase-Dev connection.

Source combines `42-add-elections-tab` commit `0f4cebaa21ebfb06a0bd94d81d28167ea5f772bf`,
the committed official-summary hotfix from main, and all subsequent summary/email
changes in this conversation. An isolated local branch `fix/dev-summary-email-parity`
preserves that combined source; the original checkout and shared Git branches were
not changed. The branch is not pushed. Direct preview deployments and the existing
dev aliases were updated; future Git deployments should include this combined
source to retain the fixes.

## Present in dev

- Disabled unavailable official-summary controls and their hover explanation.
- Bill details default to AI when official summary text is unavailable.
- Daily official-summary repair and AI regeneration with durable invalidation.
- Latest vote per representative/bill in email, AI-required readiness, title-based
  AI generation, source guards, and acknowledgement of collapsed older events.
- Five-minute morning retry window, 05:30–06:25 Eastern, with daylight-saving guards.

Applied both migrations and verified their actual objects before aligning their
recorded versions with the repository/production identifiers:

- `20261112180440_refresh_ai_on_official_summary`
- `20261112182718_email_digest_morning_retries`

Verified the new column and trigger on dev `bills`, and that only the new morning
retry email job is active. Existing ingestion and election-expiration jobs were
preserved.

Edge Functions (JWT verification enabled):

- `sync-votes`: version 36 ACTIVE.
- `send-vote-notifications`: version 29 ACTIVE; bundle SHA matches production v21.
- `sync-senate-votes`: version 5 ACTIVE, including current shared helpers.
- `sync-reps`: entrypoint already matched current source; version 5 retained.

## Verification and limits

- Dev frontend built successfully; all seven election UI focus/fixture tests passed.
- Initial repository test run: 151 passed, zero failed, eight optional checks skipped.
- With additional election PostgreSQL tests enabled, serial execution reported
  168 passed, four failures, five live acceptance checks skipped. Failures are in
  unchanged election campaign-feed/FEC code and tests, not the hotfix paths. No
  election code or tests were changed to hide them.
- All 23 notification Deno tests passed. Notification and shared refresh modules
  passed type checking. Hotfix source files matched the main working checkout.
- An initial API-created frontend preview did not inherit branch-specific public
  build settings. The active replacement explicitly uses the existing dev API
  alias and the same public dev Clerk key as the earlier branch preview. No
  private credentials were copied or exposed.
- Inspected the active built JavaScript: correct dev backend URL, dev auth key,
  new disabled-summary tooltip, and Elections feature all present.
- Active backend `/bills/hr/1` returned dev bill ID 578 and the new refresh flag.
  Direct database queries confirmed dev ID 578 versus production ID 601.
- Dev notification preview request 5821 returned HTTP 200, zero pending digests.
- Dev scheduled request 5822 returned HTTP 200, outside-window skip, zero sends.
- Dev official-summary repair request 5823 returned HTTP 200 with zero failures.
  Older dev rows without verified Congress URLs were intentionally not rewritten.
- No test emails were sent and no delivered notification rows were replayed.
- Production deployments and production database state were not changed by this task.

The dev dataset remains separate from production. These checks establish code,
schema, scheduling, and routing parity; they do not copy production user or vote data.

Bill citation new-tab behavior was subsequently deployed and verified; see bill-citation-links-verification.md.
