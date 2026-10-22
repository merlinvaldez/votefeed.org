# Release notes

## Pending hotfix — reliable simplified summaries

- Generate short summaries directly from official bill text (or the official title when no summary is available), retaining the source through up to three validation attempts.
- Retry rejected output with explicit feedback about length, prompt echoes, and missing legal qualifiers. Invalid output and provider failures are never written as cached summaries.
- Return a retryable 503 for generation failures instead of misleadingly reporting that an existing bill was not found. Emit structured diagnostics for provider errors and validation rejections.
- Share concurrent requests for the same bill, release failed requests so Retry can work, reject cached prompt echoes in feed/detail views, and expose a detail-page Retry button.
- Production summaries for S.4668, S.J.Res.197 and H.R.3633 were regenerated and repaired. The application code hotfix still requires merging its PR and deployment; these repairs alone do not deploy the new retry behavior.

## 2026-10-22 — House and Senate delegation feed

Merged through PR #39 and deployed to both production Vercel projects. Post-deploy acceptance and schedule activation are still in progress. See the [rollout checklist](specs/production-rollout-checklist.md) for operational evidence and outstanding steps.

### User-facing changes

- View House and Senate votes together, or filter by All Reps, House, Senate, and policy area.
- See matching Senate actions on a combined card while retaining each senator's identity and response. Different positions or events remain separate.
- Browse stable feed pages and continue with the available delegation when a seat is vacant.
- Open bill voting folders with chamber/member context and retain a shared simplified summary across folders.
- Compare alignment using responses linked to exact member roll calls.
- Set or clear both senators' matching responses together; clearing preserves comments.
- Use one approved comment to generate personalized contact guides for both senators.
- Use browser address autofill with shared address-field handling.

### Notifications

- Combined digests cover the user's House representative and state senators, with independent progress per chamber and Congress.
- Senate notifications include only votes occurring **after October 22, 2026**, starting October 23 at midnight New York time (`2026-10-23T04:00:00.000Z`). Older Senate votes remain available to the feed but are ineligible for notification delivery.
- House retains its September 15, 2026 midnight New York cutoff.
- Matching Senate positions can share an email line. Official bill titles provide a fallback when a usable quick summary is unavailable. Missing bill data can hold delivery until repaired.
- Preview selects digests without sending; a separate backfill mode repairs pending-vote bill data without sending.

### Engineering and deployment

- Vote identities include chamber and Congress to prevent roll-call collisions.
- Senate ingestion uses completion markers and a reviewed Congress 119 crosswalk for retryable batches and source corrections.
- Senate bill ingestion now persists official Congress.gov links required by feed identity validation, including when a summary is already cached. Missing links on previously imported bills were repaired to restore Senate cards in production.
- Migrations add exact member-vote response links, server-only feed snapshots, notification progress, and nullable interaction stances.
- `npm.cmd run test:all` runs the isolated PostgreSQL Node suite, Deno notification tests, lint, and production build.
- Frontend and backend are separate Vercel projects. The planned release path is a GitHub PR merge into `main`, followed by checking both production deployments and browser behavior. A merge may deploy them concurrently; it does not deploy Supabase functions or apply migrations.

### Rollout checkpoint

Production schema changes and the cutoff-constrained seed have been applied and recorded. Updated Edge Functions were deployed. Initial Senate ingestion and notification preview passed. Missing bill metadata was repaired; the clean preview selected one House vote and zero Senate votes per digest. No rollout-test emails were sent, and schedules remain paused at this checkpoint.

The complete published Congress 119 Senate record is now imported: 659 roll calls from 2025 and 256 from 2026, with 91,488 member positions and no completion-count mismatches. Historical feed visibility has no notification-date cutoff. The legislative feed remains bill-based and selects the latest eligible member/measure event; nominations and non-bill roll calls are stored without manufacturing bill cards. Production Senate pagination was verified back into January 2025.

Still pending: remaining production browser acceptance (including observed simplified-summary failures and cached prompt-echo copy), sender/domain configuration checks, Senate schedule installation, and schedule reactivation. Older migration-history differences remain unresolved: follow the checklist rather than running an unrestricted database push. The post-release importer repair and documentation updates need to be committed back to GitHub.

Latest local validation after the feed-link repair: 98 Node tests, 18 notification tests, lint, build, and the changed Senate function type check passed. Production preview separately verified the deployed cutoff. Historical feed visibility and pagination passed live checks; remaining UI acceptance is still open.
