# Summary Availability Implementation Plan

**Goal:** Disable unavailable official summaries in both views, default bill details to AI when official text is absent, and refresh AI text after official publication.

**Architecture:** Share the toggle’s disabled state and tooltip. Daily sync retries official text and generates AI summaries from stored official text. A database trigger invalidates AI text whenever official text changes, covering bulk ingestion, direct backfill, and Senate ingestion equally. Failed AI generation leaves a retryable null cache.

**User direction:** Continue without repeated permission questions; implement the three requested behaviors using existing production API configuration.

- [x] Add failing tests for unavailable toggles, bill default choice, and generation after official text changes.
- [x] Implement shared toggle and bill fallback without changing defaults when official text exists.
- [x] Invalidate stale AI text on official text changes; reuse the notification generator in daily sync with bounded retries and guarded writes.
- [x] Run targeted tests, frontend build, review, and production verification.

Do not generate official text. Preserve title-based AI behavior until official text arrives. Failed upstream calls must not erase official text or stop other repairs. Keep JWT protection and notification delivery behavior intact.

Completed November 12, 2026. See specs/summary-availability-verification.md for production rollout and verification.
