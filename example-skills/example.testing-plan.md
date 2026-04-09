---
name: testing-plan
description: Generate a branch-aware testing plan by comparing the current git branch and working tree against a base branch, usually `main`, then turning the delta into an unchecked checklist with exact test steps. Use when a Vercel and Supabase project changed and Codex should explain exactly how to test preview deployments, API routes, auth, migrations, RLS, environment variables, and database effects before merge or release.
---

# Testing Plan

Use this skill to produce a concrete test plan, not to claim that testing already happened. Every checkbox should stay unchecked unless the user explicitly asks you to execute tests and you actually verify them.

## Default Behavior

- Default the base branch to `main`.
- If `main` is missing locally, fall back to `origin/main`, then `master`, then `origin/master`.
- Compare from the merge base to `HEAD`, then include staged, unstaged, and untracked worktree changes.
- Produce the testing plan in chat unless the user explicitly asks for a file.
- Assume the stack is Vercel plus Supabase, but tailor the plan to the actual repository contents and changed files.

## Workflow

1. Establish scope.
   - Identify the repo root and current branch.
   - Run `python <skill-dir>/scripts/branch_test_scope.py --repo <repo-root> --base main`.
   - Read the report before inspecting files manually.

2. Confirm the real change surface.
   - Open the changed code, config, migration, and env template files that affect behavior.
   - Confirm which routes, API endpoints, auth flows, migrations, SQL policies, storage flows, and background jobs are actually impacted.
   - Do not rely on file names alone when the code makes the behavior obvious.

3. Resolve deployment context.
   - If `.vercel/project.json` exists, use it to orient the plan toward the linked Vercel project.
   - If Vercel tools are available, prefer retrieving the preview deployment URL and relevant deployment metadata directly.
   - If live Vercel access is unavailable, still write exact manual steps for how to find and test the preview deployment.

4. Build the plan.
   - Use [references/vercel-supabase-testing-rubric.md](references/vercel-supabase-testing-rubric.md) for required sections and checklist style.
   - Include only the tests that materially follow from the branch delta.
   - Use unchecked boxes: `- [ ]`.
   - Include exact paths, routes, commands, SQL, and expected outcomes when they can be inferred from the code.

5. Close with risk and blockers.
   - Call out missing preview URLs, missing seed data, unknown test accounts, unavailable secrets, or ambiguous expected results.
   - If a change is risky but the repository does not reveal enough detail to write an exact assertion, say what still needs clarification.

## Required Output Shape

Always organize the final plan under these headings when they apply:

1. `## Scope`
2. `## Setup`
3. `## Vercel Preview Checks`
4. `## API And Server Checks`
5. `## Supabase Database Checks`
6. `## Regression Sweep`
7. `## Risks / Unknowns`

Under each section:

- Use flat unchecked checkboxes only.
- Each checkbox must contain an exact action and an observable expected result.
- Prefer concrete wording like "Open `/pricing` on the preview deployment and confirm the CTA submits successfully" over vague wording like "test pricing page."

## Planning Rules

- Never mark a task complete unless you actually executed it.
- Do not tell the user to test "everything."
- Do not invent preview URLs, credentials, or seed data.
- When env vars changed, include both the Vercel preview-env verification step and the matching Supabase-side consequence if relevant.
- When migrations, policies, or SQL changed, include a Supabase SQL Editor or dashboard step plus an app-level verification step on the preview deployment.
- When auth changed, include both signed-out and signed-in checks, and call out role/RLS verification when appropriate.
- When storage changed, include upload/download/delete checks plus bucket or policy verification if the code suggests it.
- When edge functions, API routes, or server actions changed, include a direct request path and the success criteria.

## Vercel And Supabase Specific Guidance

- For Vercel preview testing, prefer exact instructions that start from the preview deployment URL.
- Include deployment-log checks when server behavior, env handling, cron, or edge/serverless code changed.
- For Supabase, prefer exact SQL snippets or dashboard pages only when they are justified by the diff.
- If the repository exposes migration files, seed files, policies, or generated types, use them to define the verification steps.
- If direct DB access is unavailable, still provide the SQL to run manually in the Supabase SQL Editor and say what result should appear.

## Helper Script

Use `scripts/branch_test_scope.py` first. It summarizes:

- branch/base/merge-base metadata
- committed and uncommitted changed files
- inferred changed preview routes and API paths
- likely Supabase migration, policy, function, and storage surfaces
- changed env vars
- linked Vercel project metadata when `.vercel/project.json` is present
- seed testing focus areas to convert into the final checklist

Example:

```powershell
python C:\Users\merli\.codex\skills\testing-plan\scripts\branch_test_scope.py `
  --repo C:\path\to\repo `
  --base main
```

## Trigger Examples

- "Use `$testing-plan` to compare this branch against main and give me a Vercel + Supabase test plan."
- "Make me a QA checklist for this feature branch before I merge it."
- "Figure out exactly how I should test this preview deployment and the related Supabase changes."
- "Turn this branch diff into a manual regression plan with checkboxes."
