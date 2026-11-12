# Email digest hotfix — November 12, 2026

## Approved behavior

- One latest vote per representative, chamber, Congress, and measure per digest.
  Different bill types remain separate. Both underlying H.Res. 1650 roll calls
  remain stored; their outbox IDs are acknowledged together after delivery.
- An email requires usable AI text. Titles, prompt echoes, failure placeholders,
  and oversized cached text cannot pass readiness checks.
- AI uses official summary text when available and only the official title when
  it is not. Title-only generation is explicitly instructed not to infer absent
  details. Source-guarded writes protect against official text arriving during
  generation; bill state is reread before delivery selection.
- Missing/failed AI holds the digest pending without advancing notification
  progress or consuming delivery-failure attempts. Successful delivery retains
  existing provider idempotency and progress checks.
- Retry every five minutes from 05:30 through 06:25 America/New_York. SQL and
  runtime guards handle daylight saving. SQL permits the entire final minute,
  including normal cron jitter. Previous email schedules are disabled.
- AI generation reserves delivery time with a 50-second budget check and existing
  30-second per-request timeout. Deferred work is retried on later invocations.

## Validation

- 120 repository Node tests passed with all PostgreSQL flags enabled; no skips.
- 23 notification Deno tests passed, including title-only prompt constraints,
  AI-required delivery, latest vote selection, and Eastern daylight-saving cases.
- Notification function and shared refresh module passed Deno type checking.
- Worker integration test covers AI failure → no send/progress/acknowledgement;
  successful retry → one line and both queue IDs acknowledged; another retry →
  no resend. It does not invoke a real email service.
- PostgreSQL test executes the actual cron migration using local fake cron/net
  services and tests its stored SQL through winter/summer and final-minute bounds.
- Independent review found and resolved the 06:25 SQL boundary issue.
- `git diff --check` passed.

## Production

- `send-vote-notifications` version 21 ACTIVE, JWT verification enabled.
- Applied migration `20261112182718_email_digest_morning_retries.sql`; repository
  filename matches production migration history.
- Only `send-vote-notifications-morning-retry` is active among email schedules.
  Its UTC cron expression is `*/5 9-11 * * *`; the SQL Eastern-time guard limits
  actual requests to the approved window.
- Preview request 4506 returned HTTP 200, zero pending votes/digests.
- Scheduled request 4507 returned HTTP 200, `outside-morning-window`, zero sends.
- No delivered votes were replayed, no outbox rows were reset, and no test email
  was sent. Actual future morning delivery remains to be observed when new votes
  enter the queue.

## Repeat the focused checks

From the repository root in PowerShell:

```powershell
.\node_modules\deno\deno.exe test --no-lock --allow-env=OPENAI_MODEL supabase/functions/send-vote-notifications
node --test tests/email-digest-delivery.test.mjs tests/summary-refresh.test.mjs
```

The next digest with new votes should contain only the latest event for each
representative/bill and an AI action phrase rather than a parenthetical raw title.
