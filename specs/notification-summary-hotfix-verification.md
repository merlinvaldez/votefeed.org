# Notification summary hotfix — October 23, 2026

Restore the existing AI-summary preference in production email notifications by deploying the validator already committed in 9cf0c7e.

- [x] Confirm production version 17 retained the obsolete source-keyword validation rule.
- [x] Run the seven existing summary tests; all passed.
- [x] Deploy version 18 to production project ycaldyqnmitdajoguagi, replacing only functions/send-vote-notifications/summary.ts with the repository copy.
- [x] Download version 18; confirm ACTIVE status, JWT verification enabled, exact validator match, and all other bundled files unchanged.
- [x] Execute the downloaded production summary resolver and plain-text sentence renderer locally with S. 2403's saved summary. Confirm it selects the AI summary and produces the expected sentence below.
- [ ] Inspect a future delivered email to confirm mailbox rendering. No email was sent or replayed during verification.

Expected sentence:

> Rep. Espaillat voted Yea on S. 2403, a bill to allow employee stock plan managers to use an outside expert's value for private company stock if the expert follows IRS rules.

Repeat the summary checks from the repository root:

```powershell
.\node_modules\.bin\deno.cmd test supabase/functions/send-vote-notifications/summary.test.ts
```

Scope: notification function validator only. Existing fallback titles remain available when no usable AI summary exists. Deployment did not invoke the sender, replay notifications, change schedules, or modify bill data. Production HTTP preview and mailbox delivery were not exercised; verification used the downloaded deployed source.
