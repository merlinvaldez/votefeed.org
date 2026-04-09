---
name: prod-plan
description: Generate a branch-aware production rollout checklist by comparing the current git branch and working tree against a base branch, usually `main`, then turning the delta into the Vercel and Supabase changes that must be applied before a production deploy. Use when Codex should prevent production breakage from missing environment variables, unsafe database migrations, unrun backfills, auth or redirect misconfiguration, storage or RLS changes, cron updates, webhook changes, or other stack-level rollout tasks.
---

# Prod Plan

Use this skill to produce a pre-production rollout checklist, not a generic deployment summary. Focus on the changes that must happen in Vercel, Supabase, and adjacent production settings before the branch can ship safely.

## Default Behavior

- Default the base branch to `main`.
- If `main` is missing locally, fall back to `origin/main`, then `master`, then `origin/master`.
- Compare from the merge base to `HEAD`, then include staged, unstaged, and untracked worktree changes.
- Produce the checklist in chat unless the user explicitly asks for a file.
- Assume the primary stack is Vercel plus Supabase, but tailor the checklist to the repository and changed files in front of you.

## Workflow

1. Establish scope.
   - Identify the repo root and current branch.
   - Run `python <skill-dir>/scripts/branch_prod_scope.py --repo <repo-root> --base main`.
   - Read the report before opening files manually.

2. Confirm the real production surface.
   - Open the changed code, config, migration, SQL, env template, and deployment files that affect runtime behavior.
   - Confirm which Vercel project settings, production environment variables, domains, cron jobs, webhooks, auth redirects, Supabase migrations, RLS policies, functions, buckets, or secrets are actually impacted.
   - Do not rely on file names alone when the code or config makes the intent obvious.

3. Resolve deployment context.
   - If `.vercel/project.json` exists, use it to orient the checklist toward the linked Vercel project.
   - If Vercel tools are available, prefer reading the linked project, production deployment, and logs directly instead of guessing.
   - If live Vercel access is unavailable, still write exact manual dashboard steps.
   - If Supabase CLI files or config exist, use them to infer the production project surfaces that need updates.

4. Build the rollout checklist.
   - Use [references/vercel-supabase-prod-rubric.md](references/vercel-supabase-prod-rubric.md) for required sections and checklist style.
   - Include only tasks that materially follow from the branch delta.
   - Use unchecked boxes: `- [ ]`.
   - Include exact env key names, config paths, SQL, dashboards, routes, functions, buckets, callback URLs, and expected outcomes whenever they can be inferred from the code.

5. Close with sequencing and blockers.
   - Call out rollout order when it matters, for example env vars before deploy, migrations before traffic, backfills before feature enablement, or redirect/domain changes before auth cutover.
   - Call out missing production values, unknown project IDs, missing preview or prod URLs, unclear backfill strategy, missing secrets, or ambiguous migration safety.
   - If a risky change is visible but the repository does not reveal enough detail to prescribe the final production step, say what still needs clarification instead of guessing.

## Required Output Shape

Always organize the final checklist under these headings when they apply:

1. `## Scope`
2. `## Rollout Order`
3. `## Vercel Production Changes`
4. `## Supabase Production Changes`
5. `## Data Safety Checks`
6. `## Post-Deploy Verification`
7. `## Risks / Blockers`

Under each section:

- Use flat unchecked checkboxes only.
- Each checkbox must contain an exact action and a concrete observable result or completion condition.
- Prefer wording like "Add `STRIPE_WEBHOOK_SECRET` to the Vercel production environment before promoting the deployment" over vague wording like "check env vars."

## Planning Rules

- Never say a production task is already complete unless you actually verified it.
- Do not tell the user to "check everything."
- Do not invent production secrets, project IDs, redirect URLs, domain names, or SQL assumptions.
- When environment variables changed, include both the Vercel production update step and the feature or server path that depends on the variable.
- When migrations, SQL, or policies changed, include the exact rollout order, the production SQL verification, and the app-level or API-level consequence.
- When auth changed, include site URL, redirect URL, callback, middleware, and session consequences when applicable.
- When storage changed, include bucket or policy setup plus upload, retrieval, signed URL, or deletion consequences when applicable.
- When cron jobs, schedules, or serverless behavior changed, include the Vercel production config step and the first verification signal after deploy.
- When webhooks or third-party callbacks changed, include both sides of the configuration if one side lives outside the repo.

## Vercel And Supabase Specific Guidance

- For Vercel, prefer explicit dashboard or config actions around production env vars, project settings, domains, cron jobs, webhooks, edge or serverless behavior, and deployment promotion.
- For Supabase, prefer exact references to migrations, SQL Editor checks, auth settings, redirect URLs, policies, functions, bucket config, and secrets only when they are justified by the diff.
- If a branch introduces a new env key that is not documented in an env template, call that out as a production blocker until the required value and owner are known.
- If a migration is destructive, irreversible, or depends on a backfill, call out the order of operations and the rollback risk explicitly.
- If direct production access is unavailable, still provide the exact manual action and the evidence that should be checked afterward.

## Helper Script

Use `scripts/branch_prod_scope.py` first. It summarizes:

- branch, base, and merge-base metadata
- committed and uncommitted changed files
- changed route and API surfaces that imply runtime impact
- changed Vercel config files and cron routes
- changed Supabase migrations, config, functions, storage, seed, and SQL surfaces
- newly referenced env vars and env template deltas
- linked Vercel project metadata when `.vercel/project.json` is present
- seed production focus areas to convert into the final checklist

Example:

```powershell
python C:\Users\merli\.codex\skills\prod-plan\scripts\branch_prod_scope.py `
  --repo C:\path\to\repo `
  --base main
```

## Trigger Examples

- "Use `$prod-plan` to compare this branch against main and tell me what I must change in Vercel and Supabase before production."
- "Make me a prod rollout checklist for this feature branch."
- "Figure out the production env vars, migrations, redirects, and stack settings I need before I deploy this."
- "Turn this branch diff into a production readiness checklist so I don't miss any Supabase or Vercel changes."
