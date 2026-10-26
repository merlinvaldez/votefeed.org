# Desired user behavior

The future Elections tab lets a VoteFeed user explore candidates for their House district and the Senate races in their state. Each published policy item identifies the candidate and race, gives a concise AI-generated explanation of one supported campaign position, and links to the official campaign page with its retrieval date. Campaign statements remain distinguishable from legislative votes.

This specification covers the backend foundations for that experience, not the tab implementation. It defines storage and query contracts for later API/UI tickets. A user response belongs to a specific position version so later campaign edits cannot change what the user answered.

## Status and scope

- Created: 2026-10-26.
- Branch inspected: `42-add-elections-tab`.
- Step 1 shared contracts implemented locally on 2026-10-26; election-geography verification remains open. Step 2 storage is implemented and verified locally; deployed permissions/migration acceptance and full-suite green status remain open. Steps 3 through 5 remain unimplemented/unverified. See [shared contracts v1](elections-contracts.md).
- Agreed flow: FEC plus state records -> candidates/races -> verified campaign websites -> Crawlee -> saved source snapshots -> AI extraction/summaries -> validation -> published database records -> later API/feed.
- AI extraction is included in the Crawlee ticket, as clarified in this conversation.
- Approved initial coverage: 2026 U.S. House and Senate general elections nationwide. Primaries, runoff stages, and special-election contests are outside this first release. Storage still distinguishes stages and special contests for future expansion. Nationwide scope does not mean both Senate seats in every state have a race; source adapters must report actual coverage and gaps.
- These three tickets do not implement React screens, public feed routes, public comments, alignment scores, notifications, campaign outreach, production deployment, or a production schedule.
- Proposed interaction default: approve/disapprove/clear with an optional private comment. No public comment feed or comment moderation/publication is included. Confirm this default against the later interaction/UI ticket before exposing it.
- Automatic publication means structurally validated, source-supported output, not a claim of perfect semantic fact checking. Manual comparison of a bounded sample is required before release.
- The story's eight acceptance-criteria aliases were unreadable through the Notion connector in the preceding inspection. This document is grounded in the readable story, the three ticket titles, and the user's clarified flow; it does not claim to reproduce those hidden criteria.

## User-facing states the backend must support

| Situation | Required result |
| --- | --- |
| Read in progress | Later UI can show loading; the read does not start a crawl or AI call. |
| Eligible published positions exist | Return candidate/race identity, summary, supporting excerpt, source URL, retrieval date, and position version. |
| No election for that seat in the selected scope | Return a distinct empty race result; do not assume both Senate seats are contested. |
| Race exists, website missing/unverified | Keep the candidate record and website status; do not fabricate positions. |
| Verified site has no supported positions | Record no positions found, distinct from opposition. |
| Source/AI processing pending or failed | Expose a safe availability status; preserve last-successful items with their original dates. |
| Candidate withdrawn or claim replaced | Exclude from current eligible content as appropriate; preserve history and earlier responses. |
| User changes or clears a response | Update their own response to that exact version; clearing stance preserves their comment. |
| Storage read fails | Propagate an error rather than returning a misleading successful empty result. |

Example: an official campaign page contains supported claims on housing and healthcare. Crawlee saves the source first. AI proposes two items, each with an exact excerpt. Only validated items are published. If healthcare wording changes, a new version is created; an earlier approval still refers to the earlier wording.

# Implementation steps

## 1. Define scope and shared contracts

Outcome: all three tickets use the same meaning of candidate, race, source, and position.

- [x] Implement explicit scope parameters for the approved 2026 nationwide House/Senate general-election release; do not interpret “current” using an undocumented date filter. Keep primaries, runoffs, and special-election contests out of release reads/import scope.
- [x] Define a race by office, state, district or Senate seat, election date, and stage. Preserve regular versus special contests and concurrent Senate races without collisions.
- [ ] Choose canonical state and at-large-district representations and map each source into them. Confirm electoral geography matches the selected election; the current district resolver alone does not prove future boundary compatibility.
- [x] Define candidate identity across FEC and state records. Use source-system identifiers and explicit unresolved-match states, never name-only merging.
- [x] Document official source adapters, precedence, checked-at times, eligibility states, and coverage reporting. FEC is useful for discovery; state election records control ballot confirmation and applicable election dates.
- [x] Define official-site verification evidence, approved destinations, and what happens when a site moves or becomes unverified.
- [x] Fix the extraction output contract: one distinct supported claim per item, topic, short summary, exact excerpt, snapshot reference, and validation outcome.
- [x] Define replacement/removal/version identity rules. Reprocessing the same snapshot and claim must be safe, while a changed claim must not inherit earlier user responses.
- [x] Define default read scope, stable ordering, eligibility filters, and safe availability statuses for later API work. Do not reuse serving-member lookup as candidate discovery.

## 2. Build database storage first — DB ticket

Outcome: candidate imports and the crawl worker can share reliable persistence functions.

Likely locations: an additive migration under `supabase/migrations/`, `server/src/db/queries/elections.js`, and focused database tests. Create the migration through the repository's Supabase CLI workflow at implementation time; do not use `db:reset` as an upgrade.

Suggested entities (names may be refined during implementation):

| Entity | Responsibility |
| --- | --- |
| election_candidates | Person and source-system identities; optional existing-member link, never a required Bioguide ID |
| election_races | Seat, office, geography, date, stage, regular/special identity |
| election_candidacies | Candidate in a particular race, party and eligibility provenance |
| campaign_sites | Proposed URL, verification state/evidence/time, approved destinations |
| campaign_sources | Immutable fetched-content snapshots and original/final URLs |
| campaign_position_versions | Supported claim, summary, topic, evidence, publication state, version history |
| election_interactions | Existing VoteFeed user, position version, stance and private comment |
| election_ingestion_runs | Stage/scope, completeness, counts, timestamps and errors |

- [x] Add required constraints, relationships, source IDs, content fingerprints, timestamps, and lookup indexes.
- [x] Store source evidence before AI processing, and record model/prompt versions for generated items.
- [x] Add transactions for atomic publication and per-race/source reconciliation. Do not hold a database transaction open while waiting for network or AI calls.
- [x] Keep failed refreshes separate from last-successful data. Successful empty/removed content needs an explicit reconciliation result.
- [x] Add shared queries for imports, snapshot saving, publication, matching-race reads, and owned responses.
- [x] Use the current Clerk-to-user mapping, ownership checks, parameterized SQL, and role-appropriate grants/RLS. Do not assume Supabase `auth.uid()` maps to the current integer user ID or that direct database roles obey browser policies.
- [x] Preserve all legislative tables and queries. Election responses do not enter bill interactions.

Local implementation and evidence: [storage functions, access model, commands and test results](elections-storage.md). DB-8 is verified against disposable local roles; deployed connection-role/default-privilege verification remains a rollout requirement. The full suite has four unrelated live Senate XML failures (HTTP 403). No production migration was applied.

### Acceptance criteria — DB

- [x] DB-1: An additive migration creates separate records for candidates, races, candidacies, campaign-site verification, source snapshots, position versions, user interactions, and ingestion runs without deleting or rewriting legislative data.
- [x] DB-2: Race identity distinguishes office (House or Senate), state, House district or Senate seat, election date, and election stage. A person can have multiple candidacies; source identifiers are unique within their source system, and name alone never establishes identity.
- [x] DB-3: Each source snapshot stores its candidacy, requested and final URL, retrieval time, extracted source text, content fingerprint, and verification provenance. Each position version stores its candidacy, topic, summary, exact supporting excerpt, snapshot reference, publication state, and model/prompt version.
- [x] DB-4: Reprocessing unchanged source content does not duplicate published items. Changed claim text or meaning creates a new position version; old source records and user responses remain attached to the text originally answered.
- [x] DB-5: Source/position publication is atomic: failures cannot expose a partially written publication. Failed refreshes retain the last successful data with its original retrieval time and a recorded failure status.
- [x] DB-6: Query functions return only eligible published positions for matching races, including candidate, race, summary, topic, supporting excerpt, source URL, retrieval time, position version ID, and the requesting user's own response when supplied by authenticated server code. Unverified and failed extraction records are excluded.
- [x] DB-7: Persistence supports one response per authenticated user and position version with approve, disapprove, or cleared stance, plus an optional private comment. Saving twice updates the same response; clearing stance preserves the comment; deleting the interaction removes that user's response/comment only.
- [ ] DB-8: Interaction access uses the existing Clerk-to-VoteFeed user mapping. Guests cannot write; users cannot read or change another user's private responses; supplied user IDs cannot override authenticated ownership. Database permissions and RLS for exposed tables are verified against the actual connection roles.
- [x] DB-9: Foreign keys, required fields, allowed values, unique constraints, and lookup indexes reject invalid links and duplicate identities. Unknown ballot/site status is distinct from verified/confirmed status. Ingestion jobs record scope, completeness, counts, timestamps, and failures without storing secrets.
- [x] DB-10: Disposable-database tests verify migration application, round-trip reads, duplicate prevention, atomic publication, position history, private-comment ownership, stance clearing, and continued operation of existing legislative queries.

## 3. Discover candidates and verify campaign sites — DISC ticket

Outcome: known candidacies and approved official campaign destinations exist before crawling.

Likely locations: `server/src/elections/syncCandidates.js`, source adapters under `server/src/elections/sources/`, shared database queries, fixture tests, and a server package script.

- [ ] Implement the selected FEC/state source adapters, pagination, normalization, and coverage accounting.
- [ ] Reconcile identities and official ballot facts; retain state-only candidates and unresolved records for review.
- [ ] Discover proposed campaign URLs from filings/official records and record verification evidence before approval.
- [ ] Add explicit withdrawal and eligibility updates without treating partial-import absence as withdrawal.
- [ ] Provide a scoped server-only command with bounded retries, safe logging, and run summaries.
- [ ] Document adapter limitations. Nationwide support requires explicit coverage evidence; implementing one state does not complete a nationwide release.

### Acceptance criteria — DISC

- [ ] DISC-1: Candidate discovery covers 2026 U.S. House and Senate general elections nationwide, excluding primaries, runoffs, and special-election contests. Document official source adapters and report coverage per state/race; unsupported or incomplete coverage cannot be reported as a complete nationwide import.
- [ ] DISC-2: Candidate discovery reads all pages of applicable FEC results, preserves FEC candidate/committee IDs and source references, and reconciles race dates and ballot status with official state election records. FEC registration alone is never labeled confirmed ballot access.
- [ ] DISC-3: Imported candidates and candidacies include name, party when available, office, normalized state, House district or Senate seat, election date/stage, source identifiers, source URLs, verification status, and checked-at time. At-large districts and concurrent Senate contests remain distinguishable.
- [ ] DISC-4: A candidate listed in official state records without a matching FEC ID can be stored with a state-scoped identifier. Ambiguous matches are flagged for resolution rather than merged by name or silently dropped.
- [ ] DISC-5: Candidate campaign website URLs from committee filings or official records are treated as proposed URLs until campaign ownership is verified. The saved record includes verification evidence and time; missing, ambiguous, outdated, or mismatched sites are not queued as verified official websites.
- [ ] DISC-6: Repeating a successful import updates matching records without duplicates and preserves earlier candidacies and sources. Explicit official withdrawal/disqualification updates eligibility without deleting history; absence from a failed or partial import never marks a candidate withdrawn.
- [ ] DISC-7: Pagination, source timeouts, malformed responses, and rate limits produce bounded retries and actionable run statuses. Partial results are labeled partial, retain provenance, and do not overwrite previously confirmed facts with guessed values.
- [ ] DISC-8: A documented server-only entry point accepts explicit scope and supports repeat runs without exposing provider credentials. Candidate identity and verified campaign-site records are persisted using the database ticket's shared queries.
- [ ] DISC-9: Fixture tests cover House, Senate, at-large districts, separate Senate seats, pagination, repeated imports, state-only candidates, ambiguous identity, missing sites, explicit withdrawal, and failed/partial source responses; a bounded live-source check documents the exact coverage verified.

## 4. Crawl, extract with AI, validate, and publish — CRAWL ticket

Outcome: verified campaign pages become source-backed feed records.

Likely locations: `server/src/elections/crawlCampaign.js`, `server/src/elections/extractPositions.js`, a dedicated campaign prompt in `server/src/ai/prompts/`, a campaign validator, shared persistence queries, and tests.

- [ ] Add Crawlee and commit the lockfile. The inspected server uses ESM JavaScript, Express 5, pg, and existing OpenAI/Agents dependencies; Crawlee is not currently declared.
- [ ] Keep Crawlee in a separate server-side worker. Start with HTML fetching; use browser rendering only when required and account for its subrequests.
- [ ] Restrict all request paths to verified public campaign destinations. Queue hostname filtering alone does not enforce redirect or network safety.
- [ ] Apply bounded crawl limits and respect crawl rules. Record unsupported PDFs, inaccessible pages, or other unsupported formats explicitly rather than silently claiming full site coverage.
- [ ] Clean page text while retaining evidence boundaries and persist the source snapshot before AI.
- [ ] Follow the pattern in `server/src/utils/aiSummaryPipeline.js`: supplied source -> model -> validation -> bounded retry. Use a separate campaign-position prompt and validator, because campaign text can contain several claims.
- [ ] Validate output structure and evidence, deduplicate claims, and publish atomically. A supporting excerpt must occur in the captured text; semantic faithfulness must also be checked in fixtures and a manual sample.
- [ ] Skip unchanged successful inputs on ordinary refreshes. Record intentional model/prompt reprocessing so it cannot duplicate cards or silently reassign responses.
- [ ] Keep secrets server-side and record actionable run failures. Website text must never authorize tools, override prompts, or change publication rules.
- [ ] Document local commands and operational limits. Decide production hosting, cadence, and initial backfill separately before rollout; do not add production jobs during specification work.

### Acceptance criteria — CRAWL

- [ ] CRAWL-1: Crawls start only from campaign websites verified by candidate discovery. Initial requests, discovered links, redirects, and browser subrequests when applicable remain within explicitly approved public campaign destinations; private/local network destinations, donation processors, social sites, and unrelated sources are excluded.
- [ ] CRAWL-2: Crawlee collects relevant public HTML policy/issue pages with bounded page count, concurrency, timeout, response size, and retries, respecting applicable crawl rules. JavaScript rendering is used only when required; blocked or unsupported content is recorded rather than bypassed.
- [ ] CRAWL-3: Before AI processing, the worker saves a source snapshot with original/final URL, retrieval time, readable text with headings and paragraphs, fingerprint, and candidacy link. Navigation, fundraising prompts, and boilerplate are excluded from policy input.
- [ ] CRAWL-4: A dedicated campaign-position AI prompt and output schema produce separate items for distinct supported policy claims. Each proposed item includes a topic, concise plain-language summary, exact supporting excerpt, and source reference. The source is treated as untrusted data, not model instructions.
- [ ] CRAWL-5: Validation checks output structure, allowed topics, nonempty summaries, excerpt presence in the supplied source, correct candidate/source association, and duplicate claims. Unsupported or ambiguous claims are withheld/flagged; no missing stance is invented, and paraphrases are not labeled verbatim quotations.
- [ ] CRAWL-6: The pipeline follows the existing source-to-AI-to-validation pattern using a separate campaign prompt/validator; bill-summary prompts and legislative data remain unchanged. AI errors and invalid outputs have bounded retries and recorded failure reasons, and invalid items are never published.
- [ ] CRAWL-7: Validated items are saved through shared database publication/versioning queries. Unchanged content is idempotent; substantive changes preserve prior versions and user responses. One page can yield multiple distinct supported items without duplicate cards for the same claim.
- [ ] CRAWL-8: A site with no supported policy text records no positions found, distinct from crawl failure, AI failure, and candidate opposition. Failed refreshes preserve last-successful items and their original source dates; successful refreshes record removed/replaced claims without deleting historical responses.
- [ ] CRAWL-9: A documented server-only worker entry point runs outside feed-read requests, accepts a bounded candidacy/site scope, records per-stage counts/statuses, and protects provider credentials. Production hosting and scheduling are documented separately before deployment.
- [ ] CRAWL-10: Controlled HTML/model fixtures verify multiple claims, boilerplate removal, unsupported claims, invalid JSON, prompt injection, duplicate content, changed/removed positions, missing policies, external links/redirects, forbidden destinations, timeouts, AI failure, and retry recovery. A small live campaign sample is manually compared with the published summaries and excerpts.

## 5. Integrate the three tickets and hand off the feed contract

Outcome: later API/UI work can read published records without invoking ingestion.

- [ ] Demonstrate discovery -> site verification -> captured source -> AI extraction -> validation -> database publication on a small House/Senate sample.
- [ ] Document input scope and returned fields for matching-race queries. Include current eligibility, safe source availability, and requesting-user-only response fields.
- [ ] Document how later routes obtain `req.user.id` using existing middleware and how guest reads differ from authenticated writes.
- [ ] Record the later work required for API endpoint implementation, pagination/filter UI, loading/empty/error presentation, and browser acceptance. Those surfaces are not completion requirements for these three foundation tickets.
- [ ] Keep the acceptance-criteria IDs in this file and the respective Notion tickets aligned when scope changes.

## Source references and current code

- Story: https://app.notion.com/p/3ff155d4c85081529055e5c05033b08c
- DB ticket: https://app.notion.com/p/405155d4c85080238a64f5f7ca4a8275
- DISC ticket: https://app.notion.com/p/405155d4c850806883b4dcd17d2d0ca9
- CRAWL ticket: https://app.notion.com/p/405155d4c85080c98c86d6ab3f0681da
- Current source-to-AI pattern: `server/src/utils/aiSummaryPipeline.js`.
- Current user mapping: `server/src/middleware/getUserFromToken.js`.
- Existing interaction query pattern: `server/src/db/queries/interactions.js`.
- Existing district lookup: `server/src/api/districts.js`; feed validation: `server/src/api/delegationFeed.js`.
- Official documentation to verify when implementing: [OpenFEC](https://api.open.fec.gov/developers/), [FEC ballot access](https://www.fec.gov/help-candidates-and-committees/registering-candidate/gaining-ballot-access/), [Crawlee link discovery](https://crawlee.dev/js/docs/introduction/adding-urls), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

# How to check it works

- [ ] Apply the new migration to a disposable database with the prerequisite schema; confirm constraints and role permissions. Existing `npm.cmd run test:all` does not apply the full Supabase migration chain.
- [ ] Run focused candidate-import fixture tests, then import the same fixture twice and verify stable row counts and identifiers.
- [ ] Verify House district, at-large district, regular Senate seat, and simultaneous special Senate contest resolve independently.
- [ ] Confirm a state-only candidate is retained, an ambiguous match stays unresolved, and a partial source failure cannot withdraw candidates.
- [ ] Try missing/unverified sites, external redirects, local/private destinations, blocked pages, and policy-free pages; verify distinct statuses and no invented policy items.
- [ ] Use controlled AI outputs to exercise valid multiple claims, malformed output, unsupported excerpts, exaggerated paraphrases, prompt injection, duplicate claims, and provider failure.
- [ ] Change and remove a source claim; confirm publication versions update appropriately and prior answers still resolve to their original source/text.
- [ ] Exercise owned response save/update/clear/delete with two users and a guest. Verify private comments do not leak, stance clearing preserves comments, and illegal ownership changes fail.
- [ ] Read the published records through the shared query contract: candidate/race, summary, excerpt, source, retrieval time, and version ID must match; failed reads must not become empty successes.
- [ ] Wire focused tests into the test runner as needed, then run `npm.cmd run test:postgres` and `npm.cmd run test:all`; record failures and test coverage rather than treating an existing green suite as proof of new behavior.
- [ ] Run a bounded live candidate/campaign check for the selected coverage and manually compare every sampled generated item with its exact source. Record actual adapter coverage and remaining gaps.
- [ ] Complete later API/UI and browser acceptance separately before claiming the Elections tab is delivered. Production rollout and scheduled-run acceptance remain separate from these local backend checks.
