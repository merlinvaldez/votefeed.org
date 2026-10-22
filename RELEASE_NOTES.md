# Release notes

## Unreleased — House and Senate delegation feed

Prepared October 22, 2026 for `37-add-senate-to-feed`. Application production deployment and post-deploy acceptance are pending. See the [rollout checklist](specs/production-rollout-checklist.md) for operational evidence and outstanding steps.

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
- Migrations add exact member-vote response links, server-only feed snapshots, notification progress, and nullable interaction stances.
- `npm.cmd run test:all` runs the isolated PostgreSQL Node suite, Deno notification tests, lint, and production build.
- Frontend and backend are separate Vercel projects. The planned release path is a GitHub PR merge into `main`, followed by checking both production deployments and browser behavior. A merge may deploy them concurrently; it does not deploy Supabase functions or apply migrations.

### Rollout checkpoint

Production schema changes and the cutoff-constrained seed have been applied and recorded. Updated Edge Functions were deployed. Initial Senate ingestion and notification preview passed. Missing bill metadata was repaired; the clean preview selected one House vote and zero Senate votes per digest. No rollout-test emails were sent, and schedules remain paused at this checkpoint.

Still pending: application merge/deployment, production browser acceptance, remaining sender/domain configuration checks, Senate schedule installation, and schedule reactivation. Initial Senate ingestion is partial; more batches are needed for full historical coverage. Older migration-history differences remain unresolved: follow the checklist rather than running an unrestricted database push.

Recorded validation: 97 Node tests passed before the cutoff change; 18 notification tests and both changed function type checks passed after it. These are local checks. Production preview separately verified the deployed cutoff; production browser acceptance remains pending.
