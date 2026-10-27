# Elections shared contracts v1

Step 1 implementation contract for DB, DISC, and CRAWL. Executable primitives live in `server/src/elections/contracts.js`. This document specifies persistence and worker behavior for later steps; it does not claim those workers or tables exist.

## Discovery and scope

The current discovery source is OpenFEC candidate and committee records. FEC registration does not confirm ballot access or prove a complete ballot. Preserve source IDs, report incomplete pagination and do not merge candidates by name. The release is scoped to 2026 regular House and Class II Senate races; the November 3 date is a scope association, not ballot confirmation. Inactive or unmappable records are retained without an eligible candidacy. House matching requires separately verified election geography.

## Campaign verification and snapshots

Site states: missing, proposed, verified, ambiguous, outdated, rejected. Verification records candidacy, requested URL, explicit approved origins and path prefixes, official ownership evidence URL/excerpt, method, verifier/version, checkedAt and invalidation reason. An authorized FEC committee record linking the site plus consistent candidate/race identity can establish ownership; search rank, HTTPS and matching names cannot. Each redirect destination requires explicit approval. Donation/social/vendor links confer no approval. Public-network enforcement must cover DNS, redirects and browser subrequests in the CRAWL step.

Moved sites become proposed until reverified; revoke old approvals and stop new crawl/publication. An unverified site excludes its positions from current reads while retaining snapshots/versions/responses. A transient crawl failure on a still-verified site preserves last-successful publication. No arbitrary verification expiry is invented: DISC must set an explicit review deadline and invalidate on ownership/identity changes.

Snapshots are immutable: ID, candidacyId, site verification revision, requested/final URL, retrievedAt, cleaned text, SHA-256 of exact UTF-8 text, and verification evidence. Persist before extraction. Retry identity is `(candidacyId, final URL, content fingerprint, verification revision)`; record later fetch attempts separately without changing original retrievedAt.

## Extraction, validation and versions

Extraction envelope: `{snapshotId, candidacyId, model, promptVersion, items}`. Each item is `{snapshotId, candidacyId, topic, claimText, summary, excerpt}`: exactly one distinct supported policy claim, one allowed topic from `TOPICS`, summary 1–500 characters, nonempty exact contiguous excerpt from captured text. `claimText` is the explicit supported proposition, not the summary. Unsupported/ambiguous assertions are withheld; missing policy text means no positions, never opposition. Model output is untrusted and cannot approve itself.

`validateExtractionItem` checks basic structure and evidence association, returning invalid or requires-semantic-validation. Worker validation adds single-claim, semantic faithfulness, duplicate and candidate checks, with outcome valid/invalid/needs-review, reason codes and validator version. Only valid items can publish. Prompt/model revisions and validation evidence are stored even for rejected attempts. Website instructions cannot authorize tools or alter rules.

Each reconciled claim has an immutable internal claimId scoped to candidacy, assigned by publication reconciliation, never by topic, page index, or model assertion. A position version key hashes candidacyId, claimId and exact accepted claimText. Same snapshot/claim retry reuses the existing result. New snapshots supporting unchanged accepted text attach evidence without duplicating a card or rewriting historical evidence. A summary-only regeneration is a recorded presentation revision, not a silent edit to an answered version. Changed text or meaning creates a new immutable position version and supersedes the previous current version, even if a model labels it unchanged. Uncertain lineage requires review or a new claim, never inherited responses. Historical responses stay bound to their original version and displayed wording/evidence.

Publication states: draft, published, superseded, removed, withheld. Successful complete source reconciliation explicitly marks removed/replaced claims in one transaction with new publication. Partial/failed runs cannot remove claims. No network/AI wait occurs inside a transaction. Version history and interactions are never deleted by reconciliation.

## Later read and response contract

Read input: explicit release scope plus `{state, district, geographyEvidenceId}`, limit default 20 (1–50), optional opaque cursor, optional authenticated server user. Serving-member lookup is never candidate discovery. Later API code derives userId from `req.user.id` via existing Clerk middleware; client user IDs are rejected. Guest reads have no response data.

Filter by approved release scope, matching verified election geography, FEC-registered candidacy, verified site and current published valid version. Stable ascending order: electionDate, state, office, seat number, raceId, candidateId, claimId, positionVersionId; compare IDs deterministically, not localized display names. Cursor binds filter/scope and publication snapshot; changes require restart rather than shifting pages.

Result: `{scope, coverage, races, items, nextCursor}`. Race entries include identity, availability, lastAttemptAt, lastSuccessAt and safe failure code. Items include candidate `{id, name, party}`, race, candidacyId, claimId, positionVersionId, topic, summary, excerpt, source `{snapshotId, url, retrievedAt}`, availability and requesting user's own `{stance, privateComment}` or null. Never expose other users' interactions or raw ingestion errors. A failed refresh can return last-successful items with original source dates and failure availability. Unknown coverage, verified no-race, missing/unverified site, pending, no-positions, crawl-failed and extraction-failed remain distinguishable (`AVAILABILITY`). Storage errors propagate as errors, never empty success.

One interaction per owned user/version: stance approve/disapprove/null and optional private comment. Clearing stance preserves the comment; deletion removes only that user's interaction. These defaults require confirmation in the later UI ticket. Election responses never enter legislative interactions, alignment or notifications.
