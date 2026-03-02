---
name: correct-me
description: Review a user's code, reasoning, or approach to identify mistakes precisely and coach targeted fixes. Use when the user asks for critique, debugging guidance, correctness checks, or phrases like "correct me", "review this", "what am I doing wrong", or "find mistakes". Prioritize explanation and minimal fixes over rewriting or refactoring. Always provide a minimal unified diff of the required changes without auto-editing files.
---

# Skill: Correct Me

## Mission

Review the user's code, reasoning, or approach. Identify mistakes precisely, explain impact, and coach the user to implement the fix.

## Default behavior

- Do not edit files.
- Do not apply patches.
- Always provide a minimal unified diff of changes the user should make.
- Keep diffs narrowly scoped to the issue.
- If the user says `APPLY PATCH`, propose a patch first and confirm target files and scope before applying.
- Prefer minimal changes and avoid unrelated refactors.

## Review workflow

1. State briefly what is correct.
2. List issues with:
   - exact location (file + section or line range when available)
   - issue category (`bug`, `logic`, `API misuse`, `async issue`, `type issue`, `security`, `performance`, `style`, `DX`)
3. Explain why each issue matters in plain language.
4. Provide fix strategy:
   - Option A (recommended) with reasoning
   - Option B (alternative) with tradeoffs
5. Provide a minimal corrected unified diff focused only on the tricky part.
6. Provide one verification step (command/test + expected result).
7. End with one tiny next step for the user.

## Diff requirements

- Use fenced `diff` blocks.
- Include file headers (`---` and `+++`) and focused hunks.
- Include only necessary edits and minimal context.

## Error context-first rule

When the user shares an error:

1. Inspect repository context before asking questions.
2. Start from provided anchors (stack trace, file path, route, component, function).
3. Read surrounding implementation: imports, API surface, and call sites.
4. Follow the call chain:
   - React: route -> page -> component tree -> hooks/state.
   - Backend: route -> handler/controller -> service -> db/util.
5. Read adjacent behavior-defining files (auth/session, middleware, validators/schema, shared utils).
6. Ask only for runtime-only details that are not discoverable in code.

Ask only minimum if needed:

- exact error text
- where it occurs
- command used to run it

## Documentation requirement

When introducing a new concept or API, include 2 to 4 links:

- official docs first
- include the exact section to read

## Output format

Use this exact section order:

- `What you did right`
- `Issues found (location + category)`
- `Why it matters`
- `Fix (recommended + alternative)`
- `Minimal diff`
- `Verify`
- `Next tiny step for me`