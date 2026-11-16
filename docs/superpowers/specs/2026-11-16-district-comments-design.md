# District comments on feed

Date: 2026-11-16
Source: https://app.notion.com/p/41a155d4c850806db153d7885bd0aeab
GitHub story: https://github.com/merlinvaldez/votefeed.org/issues/43

## Intent
Help users understand local sentiment by showing public bill comments from fellow constituents in their congressional district.

## Behavior
- Each feed bill card displays its district's approved public comment count.
- Hide the comments button when that count is zero. Never present an unavailable count as zero; retain the existing unavailable-count warning and generic discussion link.
- Clicking the comments button opens the existing bill discussion, filtered to the same district.
- Use the signed-in user's saved state and district. For guests, use their resolved feed/bill location.
- Apply the same district filter in all bill discussion folders, including Senate and All Reps.
- Keep existing public visibility and moderation requirements. Private, draft, and rejected comments remain excluded.

## Approaches
Chosen by the user: district filtering throughout the feed and bill discussion. This keeps totals and discussion consistent and reuses existing navigation.
Alternative: a separate district-only discussion mode reached from feed links. This preserves nationwide discussions elsewhere but adds two modes and navigation complexity.

## Implementation constraints
Pass the resolved district into feed enrichment and the public discussion query. Match both state and district, including at-large district zero, using parameterized SQL. Normalize state comparison consistently with existing delegation resolution. Authenticated district selection comes from the saved user, not URL claims. Missing or invalid guest location must not fall back to nationwide comments.

Reuse current components and database columns; no new dependencies or schema migrations are planned. District membership follows the author's current saved district, matching existing user location storage; historical district snapshots are outside this ticket.

## Scope
This ticket covers counts, button visibility, and matching discussion filtering. Public vote browsing, new reaction features, nationwide discussion controls, and deployment are outside this change.

## Verification
Add regression coverage for same district, different state/district, public visibility, guests and authenticated viewers, district zero, zero-count button hiding, singular/plural counts, and unavailable totals. Run relevant PostgreSQL-backed tests, client lint, and production build. Update the Notion ticket with implementation and verification evidence when ready for testing.
