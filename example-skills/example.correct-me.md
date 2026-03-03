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
- For existing code changes, provide an annotated unified diff of changes the user should make.
- For brand-new code/components, provide a fully annotated code snippet.
- Keep diffs narrowly scoped to the issue.
- If the user says `APPLY PATCH`, propose a patch first and confirm target files and scope before applying.
- Prefer minimal changes and avoid unrelated refactors.

## File path format

- Do not output clickable links for local files.
- Do not use `vscode://`, `file://`, `http://`, or `https://` for local code references.
- Output plain absolute paths only, in this format:
- `/c:/Users/merli/Desktop/repos/coursework/voteFeed/<path-from-repo-root>`
- Example:
- `/c:/Users/merli/Desktop/repos/coursework/voteFeed/client/src/AuthContext.jsx`

## Change-type decision rule

- Decide output mode before writing fixes:
1. New code mode: the user needs a brand-new file/component.
2. Existing code mode: the user needs edits to existing repo code.
- If uncertain, inspect surrounding files first and ask one concise clarification question only if needed.
- Do not mix modes in one output block: snippets for new code, diffs for existing code.

## Review workflow

1. State briefly what is correct.
2. List issues with:
   - exact location (file + section or line range when available)
   - issue category (`bug`, `logic`, `API misuse`, `async issue`, `type issue`, `security`, `performance`, `style`, `DX`)
3. Explain why each issue matters in plain language.
4. Provide fix strategy:
   - Option A (recommended) with reasoning
   - Option B (alternative) with tradeoffs
5. Provide output in the selected mode:
   - New code mode: annotated snippet with line-by-line comments.
   - Existing code mode: annotated unified diff focused only on the tricky part, plus line-by-line comments for every changed line.
6. Provide one verification step (command/test + expected result).
7. End with one tiny next step for the user.

## Diff requirements

- Use fenced `diff` blocks.
- Include file headers (`---` and `+++`) and focused hunks.
- Include only necessary edits and minimal context.
- Explain every changed line in order.
- Prefer inline comments on added lines when syntax allows.
- For removed lines or non-commentable formats, add a `Line-by-line diff comments` section immediately after the diff.

## New code snippet requirements

- Use fenced code blocks with the correct language tag.
- Ensure every non-empty line is explained with an inline comment or an immediately adjacent comment line.
- Keep snippets minimal, directly runnable, and scoped to the issue.

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
- `Output (annotated snippet or annotated diff)`
- `Line-by-line comments (every changed line explained)`
- `Verify`
- `Next tiny step for me`

## Exemplar response

Use exemplars like the following and preserve the exact section order.

### Exemplar A: existing code mode (`annotated diff`)

What you did right
- You added an auth guard in middleware and kept the change localized.

Issues found (location + category)
- `/c:/Users/merli/Desktop/repos/coursework/voteFeed/server/src/middleware/requireUser.js` (`logic`)
- The guard branch calls `next()` for missing users, which allows unauthorized access.

Why it matters
- Protected routes become reachable without authentication.

Fix (recommended + alternative)
- Recommended: return `401` immediately when `req.user` is missing.
- Alternative: throw a custom auth error and map it in centralized error middleware.

Output (annotated snippet or annotated diff)
```diff
--- a/server/src/middleware/requireUser.js
+++ b/server/src/middleware/requireUser.js
@@
-  if (!req.user) {
-    next();
-  }
+  if (!req.user) { // Detect missing authenticated user on the request.
+    return res.status(401).json({ error: "Unauthorized" }); // Send unauthorized response and stop middleware chain.
+  } // End unauthorized branch.
```

Line-by-line comments (every changed line explained)
- `-  if (!req.user) {`: Previous condition was correct but enforcement was missing.
- `-    next();`: This advanced execution instead of blocking unauthorized access.
- `-  }`: Closed a non-blocking branch.
- `+  if (!req.user) {`: Keeps the same check.
- `+    return res.status(401).json({ error: "Unauthorized" });`: Enforces access control and exits early.
- `+  }`: Closes the corrected guard branch.

Verify
- Call a protected endpoint without auth and confirm `401`.

Next tiny step for me
- Apply this diff, re-run one protected-route request, and share the status/body.

### Exemplar B: new code mode (`annotated snippet`)

What you did right
- You isolated role-check logic into a helper candidate.

Issues found (location + category)
- `/c:/Users/merli/Desktop/repos/coursework/voteFeed/server/src/utils/isAdmin.js` (`DX`)
- The helper does not guard against missing user objects.

Why it matters
- Callers can crash with `Cannot read properties of undefined`.

Fix (recommended + alternative)
- Recommended: add a null guard and return boolean deterministically.
- Alternative: throw explicit errors and require callers to catch them.

Output (annotated snippet or annotated diff)
```js
export function isAdmin(user) { // Export helper for role checks.
  if (!user) return false; // Guard against null or undefined input.
  return user.role === "admin"; // Return true only for admin role.
} // End helper.
```

Line-by-line comments (every changed line explained)
- `export function isAdmin(user) {`: Defines and exports reusable utility.
- `if (!user) return false;`: Prevents runtime errors from missing input.
- `return user.role === "admin";`: Implements the role decision rule.
- `}`: Closes function block.

Verify
- Run unit test or a quick Node call with `undefined` and `{ role: "admin" }`.

Next tiny step for me
- Add one test case for `undefined` input and one for admin/non-admin roles.
