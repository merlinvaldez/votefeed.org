# Approved Email Digest Hotfix

**Goal:** One latest vote per representative and bill per digest, with AI required before delivery and bounded morning retries.

**Approved approach:** Use official text for AI when available and title-only input otherwise. Keep an unready digest queued, preserve delivery idempotency and only advance progress after delivery. Retain all represented outbox IDs when collapsing older votes. Preserve distinct chambers, members, Congresses and bill types.

- [x] Pin duplicate roll-call collapse, queue acknowledgement and AI readiness with failing tests.
- [x] Require usable AI, support title-derived generation and guard source changes.
- [x] Schedule retries every five minutes from 5:30 through 6:25 a.m. Eastern using an Eastern-time guard so daylight-saving changes do not shift delivery.
- [x] Test retries, failure isolation, source races, no resend after progress, and type-check.
- [x] Review, deploy, and verify through preview/generate-only modes without sending test email to users.

Keep existing uncommitted summary-availability changes intact. Use existing production API configuration. Never replay already delivered votes as part of verification.

Completed and deployed. Production verification: specs/email-digest-hotfix-verification.md.
