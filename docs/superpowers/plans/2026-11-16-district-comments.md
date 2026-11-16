# District Comments Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Show district public comment totals and matching district discussions.

**Architecture:** Reuse public comment queries with a required state/district filter. Resolve authenticated locations server-side and guest locations from validated query parameters; reuse the bill detail delegation location in the client.

**Tech Stack:** Express, PostgreSQL, React, Node test runner, Vite.

**Spec:** docs/superpowers/specs/2026-11-16-district-comments-design.md

## Global Constraints
- No new dependencies or schema migrations.
- Retain public visibility and moderation requirements.
- Authenticated district selection comes from the saved user, not URL claims.
- Missing or invalid guest location must not fall back to nationwide comments.

## Review Focus
- At-large district zero remains valid.
- Identical district numbers in different states never share comments.
- Missing user district fails closed rather than returning nationwide comments.
- Failed count queries preserve unknown totals and warning behavior.
- All discussion refreshes after publishing or editing retain the district scope.

### Task 1: District-scoped public queries and endpoint
**Files:** server/src/db/queries/comments.js; server/src/api/comments.js; server/src/db/queries/delegationFeedPage.js; tests/feed-public-comments.test.mjs; tests/district-comments.test.mjs; tests/delegation-votes.test.mjs.
**Interfaces:** getPublicBillCommentCounts(billIds, runner, location); listPublicCommentsByBillId(billId, { viewerUserId, location }, runner). Feed enrichment uses page.delegation. Endpoint uses req.user location when authenticated, otherwise validated req.query.
- [x] Add failing real PostgreSQL tests for district count/list consistency, privacy, state boundaries, district zero; endpoint tests for authenticated authority and guest validation.
- [x] Run new tests and confirm behavior fails before implementation.
- [x] Implement required district predicates and endpoint validation. Pass page delegation into count query and update existing fixture columns.
- [x] Run query, endpoint, and feed regression tests; expect all passing.

### Task 2: Scoped discussion requests and feed controls
**Files:** client/src/BillPage.jsx; client/src/LegislativeVoteCard.jsx; client/src/publicComments.js; tests/legislative-card.test.mjs; tests/district-comments-client.test.mjs.
**Interfaces:** publicCommentsUrl(apiBase, billId, location) produces the discussion URL with state/district for guest requests; signed-in server ignores supplied location in favor of saved user.
- [x] Add failing tests for guest district zero URLs, invalid location, positive count labels, hidden zero button, and unknown-count link.
- [x] Run tests and observe expected failures.
- [x] Use detail.delegation in all public discussion requests and hide only known zero counts; preserve unknown link and warning.
- [x] Run client regression tests, lint and production build; expect passing.

### Task 3: Verification and ticket evidence
- [x] Run npm run test:all and inspect results.
- [x] Review diff against design and verify all request sites preserve district scope.
- [x] Commit implementation and update Notion ticket to Ready for Testing with test evidence, keeping production completion distinct.

## Execution ledger
- Approved design; implementing in existing user-requested branch 43-district-constituent-votes-and-comments in the shared checkout. No additional worktree needed.
- Task 1 complete: regression tests demonstrated nationwide totals and missing-location fallback; required district query predicates and saved-user authority now pass real PostgreSQL and endpoint tests.
- Task 2 complete: repaired crash-corrupted publicComments.js, completed import and all request arguments, and hid zero buttons. Browser regression demonstrated guest navigation failure, then passed after removing the read-only sign-in gate.
- Review: independent reviewer found no important defects; added browser action coverage for the reported integration-test gap.
- Final verification: npm run test:all passed 124 Node tests (none skipped), 21 Deno notification tests, client lint, and production build. Existing local NODE_ENV configuration emits a Vite warning; build exits successfully.
- Browser verification: tests/helpers/district-comments-browser.cjs passed guest navigation, hidden zero count, All Reps/House/Senate discussion requests, and submission/publishing/editing refreshes (seven requests retained Alaska district zero).
- Task 3 complete: Notion ticket acceptance checkboxes checked, evidence appended, and status set to Ready for Testing. Deployment and merge remain outside scope.
