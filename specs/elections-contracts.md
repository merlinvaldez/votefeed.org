# Elections shared contracts v1

Step 1 implementation contract for DB, DISC, and CRAWL. Executable primitives live in `server/src/elections/contracts.js`. This document specifies persistence and worker behavior for later steps; it does not claim those workers or tables exist.

## Current policy: FEC-first candidate positions (2026-10-26)

FEC registration is sufficient to discover candidates, collect verified campaign positions, and include published positions in the exploratory feed. State ballot confirmation is optional enrichment, not a launch prerequisite. Earlier ballot-only gates below are superseded by this policy.

Use the label `fec-registered` alongside a separate `ballotStatus` (`unknown` unless supported by state evidence). Never describe this roster as everyone on your ballot or as a definitive general-election matchup. State records still control ballot confirmation, withdrawals/disqualifications, and definitive ballot claims. Known withdrawn/disqualified candidacies remain excluded; FEC refreshes cannot overwrite state eligibility.

The current release maps FEC House districts and regular Class II Senate contests to November 3, 2026; this is a discovery scope association, not proof a registrant reached the general ballot. Inactive/past FEC records, missing House districts and out-of-scope Senate contests are retained without a feed candidacy. Identity collisions require review, never name-only merging. No state source adapter is required for an FEC-only run. FEC pagination completeness is reported separately from state ballot coverage and proves neither a complete ballot nor no election.

Campaign website verification remains required: an authorized FEC committee link tied to the exact candidate ID, plus destination identity/office checks, can establish ownership. Existing crawl, extraction, semantic validation, publication, geography, and private-response safeguards remain required. State-only candidates remain supported. No production deployment or import is implied.

Implementation update, 2026-10-26: steps 2 and bounded step 3 now provide the storage and discovery worker described in [elections-discovery.md](elections-discovery.md). Ballot extraction uses deterministic parsing or a replaceable AI extraction/verification provider. Source observations may precede resolved identities/races. Official state-only observations can establish an internally identified candidacy without a FEC match; row locators are evidence identifiers, never official person IDs. Nationwide coverage, House geography, and production acceptance remain separate.

## Scope and geography

All imports and reads default to `RELEASE_SCOPE`: cycle 2026, House and Senate, 50 states, general stage, regular contests. Explicit overrides may narrow states/offices, never broaden the release. Validate every imported race with `isReleaseRace`; do not derive “current” from the clock. Election dates come from state records, not a guessed nationwide date. DC and territories are outside this voting House/Senate scope.

Race identity is the tuple returned by `raceKey`: office, postal state, numeric House district or Senate class (1/2/3), ISO election date, stage, contest type. House at-large is integer 0; FEC `00`, Census `00`, and state `AL`/`at-large` map to 0; numbered districts lose leading zeros. State adapters map state names/FIPS to postal codes before calling the strict normalizer. Unknown seat/class remains unresolved, never guessed. Senate senior/junior is not a seat identifier. Special versus regular and distinct Senate classes cannot collide.

District normalization is representation only, not proof that a district exists. Before enabling House matching, persist election-geography evidence `{state, cycle, boundaryVersion, sourceUrl, checkedAt, status}` with status verified/unresolved. Require state-certified election boundaries or election-specific Census boundaries confirmed against state records. The existing resolver identifies current representation and does not establish 2026 compatibility. Unverified locations return `geography-unverified`, never guessed House matches. Senate state matching can proceed independently.

Official evidence checked 2026-10-26: [House district guidance](https://www.house.gov/representatives/find-your-representative) distinguishes 2026 voting districts from current representation. [Census congressional districts](https://www.census.gov/programs-surveys/decennial-census/about/rdo/congressional-districts.html) provides election-specific district products. Runtime per-state verification remains a DISC prerequisite; no nationwide boundary audit is claimed here.

## Identity, adapters, and coverage

Candidates have internal immutable IDs independent of serving members; Bioguide links are optional. Source identities are unique `(system, id)`, encoded by `sourceIdentityKey`. Names never merge identities. Namespace examples: `fec:candidate`, `fec:committee`, `state:NY:candidate`. Committee identity is a related entity, not proof two candidates are one person. Preserve source IDs as strings. State IDs reused between elections must include cycle in their namespace.

Matching outcomes: matched (exact known identifier or explicit official cross-reference), unresolved (insufficient evidence), ambiguous (conflicting possibilities), rejected (evidence rules out match). Unresolved state-only candidates retain their own internal records. Later resolutions record evidence and actor/time; no automatic name-based merge or history deletion.

| Adapter contract | Official source and precedence | Required result |
| --- | --- | --- |
| FEC discovery | [OpenFEC](https://api.open.fec.gov/developers/), candidate and committee records | Read all pages; preserve IDs, filing references and proposed URLs; registration is discovery only |
| State ballot adapter per state | State chief election authority's certified federal general-election candidate lists, calendars, corrections and withdrawal notices | Controls ballot status, seat, applicable date and explicit withdrawal; save exact official artifact URL and record locator |
| Geography adapter per state | State election boundaries, checked against election-specific Census products | Controls verified election district compatibility |

[FEC guidance](https://www.fec.gov/help-candidates-and-committees/registering-candidate/gaining-ballot-access/) confirms state law controls ballot access. Conflicts between official artifacts stay unresolved until dated corrections/authority establish precedence. A newer FEC fetch cannot overwrite state ballot facts.

Every observation includes source system/ID, URL, retrievedAt, checkedAt, effective date when provided, and evidence/record locator. Eligibility: unknown, filed, ballot-confirmed, withdrawn, disqualified. FEC-registered or state ballot-confirmed candidacies are feed eligible, excluding known withdrawals/disqualifications. Absence is not withdrawal. Reconciliation can mark absence only after a complete authoritative snapshot for that exact scope with an explicit removal result.

Each run reports requested cycle/stage/type/states/offices, adapter/version, start/end, per-state/office/race status (complete/partial/failed/unsupported), pages expected/read, record counts, unresolved counts, errors and last successful run. No races is authoritative only after complete state coverage; unsupported/partial is `coverage-unknown`. All 50 state adapters and election geography checks are required for a complete nationwide import. None are implemented by step 1; the adapter inventory starts unsupported, never complete.

## Campaign verification and snapshots

Site states: missing, proposed, verified, ambiguous, outdated, rejected. Verification records candidacy, requested URL, explicit approved origins and path prefixes, official ownership evidence URL/excerpt, method, verifier/version, checkedAt and invalidation reason. An official ballot record or candidate filing linking the site plus consistent candidate/race identity can establish ownership; search rank, HTTPS and matching names cannot. Each redirect destination requires explicit approval. Donation/social/vendor links confer no approval. Public-network enforcement must cover DNS, redirects and browser subrequests in the CRAWL step.

Moved sites become proposed until reverified; revoke old approvals and stop new crawl/publication. An unverified site excludes its positions from current reads while retaining snapshots/versions/responses. A transient crawl failure on a still-verified site preserves last-successful publication. No arbitrary verification expiry is invented: DISC must set an explicit review deadline and invalidate on ownership/identity changes.

Snapshots are immutable: ID, candidacyId, site verification revision, requested/final URL, retrievedAt, cleaned text, SHA-256 of exact UTF-8 text, and verification evidence. Persist before extraction. Retry identity is `(candidacyId, final URL, content fingerprint, verification revision)`; record later fetch attempts separately without changing original retrievedAt.

## Extraction, validation and versions

Extraction envelope: `{snapshotId, candidacyId, model, promptVersion, items}`. Each item is `{snapshotId, candidacyId, topic, claimText, summary, excerpt}`: exactly one distinct supported policy claim, one allowed topic from `TOPICS`, summary 1–500 characters, nonempty exact contiguous excerpt from captured text. `claimText` is the explicit supported proposition, not the summary. Unsupported/ambiguous assertions are withheld; missing policy text means no positions, never opposition. Model output is untrusted and cannot approve itself.

`validateExtractionItem` checks basic structure and evidence association, returning invalid or requires-semantic-validation. Worker validation adds single-claim, semantic faithfulness, duplicate and candidate checks, with outcome valid/invalid/needs-review, reason codes and validator version. Only valid items can publish. Prompt/model revisions and validation evidence are stored even for rejected attempts. Website instructions cannot authorize tools or alter rules.

Each reconciled claim has an immutable internal claimId scoped to candidacy, assigned by publication reconciliation, never by topic, page index, or model assertion. A position version key hashes candidacyId, claimId and exact accepted claimText. Same snapshot/claim retry reuses the existing result. New snapshots supporting unchanged accepted text attach evidence without duplicating a card or rewriting historical evidence. A summary-only regeneration is a recorded presentation revision, not a silent edit to an answered version. Changed text or meaning creates a new immutable position version and supersedes the previous current version, even if a model labels it unchanged. Uncertain lineage requires review or a new claim, never inherited responses. Historical responses stay bound to their original version and displayed wording/evidence.

Publication states: draft, published, superseded, removed, withheld. Successful complete source reconciliation explicitly marks removed/replaced claims in one transaction with new publication. Partial/failed runs cannot remove claims. No network/AI wait occurs inside a transaction. Version history and interactions are never deleted by reconciliation.

## Later read and response contract

Read input: explicit release scope plus `{state, district, geographyEvidenceId}`, limit default 20 (1–50), optional opaque cursor, optional authenticated server user. Serving-member lookup is never candidate discovery. Later API code derives userId from `req.user.id` via existing Clerk middleware; client user IDs are rejected. Guest reads have no response data.

Filter by approved release scope, matching verified election geography, FEC-registered or ballot-confirmed candidacy, verified site and current published valid version. Stable ascending order: electionDate, state, office, seat number, raceId, candidateId, claimId, positionVersionId; compare IDs deterministically, not localized display names. Cursor binds filter/scope and publication snapshot; changes require restart rather than shifting pages.

Result: `{scope, coverage, races, items, nextCursor}`. Race entries include identity, availability, lastAttemptAt, lastSuccessAt and safe failure code. Items include candidate `{id, name, party}`, race, candidacyId, claimId, positionVersionId, topic, summary, excerpt, source `{snapshotId, url, retrievedAt}`, availability and requesting user's own `{stance, privateComment}` or null. Never expose other users' interactions or raw ingestion errors. A failed refresh can return last-successful items with original source dates and failure availability. Unknown coverage, verified no-race, missing/unverified site, pending, no-positions, crawl-failed and extraction-failed remain distinguishable (`AVAILABILITY`). Storage errors propagate as errors, never empty success.

One interaction per owned user/version: stance approve/disapprove/null and optional private comment. Clearing stance preserves the comment; deletion removes only that user's interaction. These defaults require confirmation in the later UI ticket. Election responses never enter legislative interactions, alignment or notifications.
