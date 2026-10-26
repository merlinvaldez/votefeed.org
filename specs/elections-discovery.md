# Public-source candidate discovery

Implemented locally on October 26, 2026. This replaces a vendor-dependent candidate-list plan with FEC discovery, our own official-source archive, deterministic or AI-assisted ballot extraction, validation, and evidence-backed database promotion. No production migration, candidate import, or schedule was applied.

## Current policy: FEC-first candidate positions (2026-10-26)

FEC registration is sufficient to discover candidates, collect verified campaign positions, and include published positions in the exploratory feed. State ballot confirmation is optional enrichment, not a launch prerequisite. Earlier ballot-only gates below are superseded by this policy.

Use the label `fec-registered` alongside a separate `ballotStatus` (`unknown` unless supported by state evidence). Never describe this roster as everyone on your ballot or as a definitive general-election matchup. State records still control ballot confirmation, withdrawals/disqualifications, and definitive ballot claims. Known withdrawn/disqualified candidacies remain excluded; FEC refreshes cannot overwrite state eligibility.

The current release maps FEC House districts and regular Class II Senate contests to November 3, 2026; this is a discovery scope association, not proof a registrant reached the general ballot. Inactive/past FEC records, missing House districts and out-of-scope Senate contests are retained without a feed candidacy. Identity collisions require review, never name-only merging. No state source adapter is required for an FEC-only run. FEC pagination completeness is reported separately from state ballot coverage and proves neither a complete ballot nor no election.

Campaign website verification remains required: an authorized FEC committee link tied to the exact candidate ID, plus destination identity/office checks, can establish ownership. Existing crawl, extraction, semantic validation, publication, geography, and private-response safeguards remain required. State-only candidates remain supported. No production deployment or import is implied.

## What runs now

`server/src/elections/cli.js` runs outside feed requests. Its dependencies are ordinary JavaScript modules, with a replaceable search/extraction provider:

| Module | Responsibility |
| --- | --- |
| `discoveryUtils.js` | Explicit release scope, canonical hashing, safe error codes and URLs |
| `publicHttp.js` | Bounded public HTTPS requests, pinned DNS, redirects and retries |
| `sources/fec.js` | All-page FEC candidate/committee discovery; websites remain proposals |
| `sources/wyoming.js` | Reviewed Wyoming general-election CSV and race/date evidence |
| `ballotExtraction.js` | CSV/PDF/HTML text handling, scope/evidence checks, duplicate and ambiguity handling |
| `openaiDiscoveryProvider.js` | Official-domain source search, structured extraction, independent verification |
| `sourceOnboarding.js` | Locked atomic search/inspection checkpoints, bounded concurrency, raw archives and offline 50-state gap reports |
| `syncCandidates.js` | Persist source first, extract, validate, retain observations, promote supported records, report coverage |
| `verifyCampaignSite.js` | Optional checks of official ballot-linked campaign destinations |
| `db/queries/electionDiscovery.js` | Immutable source/observation storage and audited identity resolution |

The OpenAI adapter uses the existing server key, authorized for reuse. It defaults to the existing `OPENAI_MODEL` or `gpt-5.4`, with `ELECTIONS_AI_MODEL` available as a discovery-specific override. It does not modify the legislative summary prompt or model settings. Model clients use bounded requests; extraction/verification have no search tools. Source search uses at most two web-search tool calls per state and filters to the directory-listed authority domain. Returned URLs must also pass the exact-origin filter. Search results are **proposals**, never approved official-source descriptors or ballot confirmations.

Provider interface: `search({state,authorityUrl,scope})`, `extract({text,source})`, and `verify({text,source,rows})`, plus `model` and `promptVersion` metadata. A different provider can implement this boundary without changing candidate identities or stored evidence.

## Storage and identity

The additive migration `20261026203305_election_discovery_observations.sql` adds four server-only tables with RLS, browser-role revocations, immutable-history triggers, and explicit relationships:

- `election_source_documents`: original bytes, requested/final URL, retrieval/effective date, extracted text, content hash, and reviewed source context. Raw bytes are saved before parsing. The extracted-text representation is saved separately; repeated identical input/context preserves the first retrieval date.
- `election_discovery_attempts`: extractor/model/prompt, outcome, validation results, run reference and safe failure codes.
- `election_discovery_observations`: original/normalized observations and validation decisions. Reprocessing a changed model/validation decision creates another immutable observation; it cannot overwrite the earlier decision. Repeating the same decision reuses the observation while recording another attempt.
- `election_observation_resolutions`: audited links to internal candidates and optional candidacies. A compound foreign key prevents linking a candidacy owned by a different candidate.

State-only ballot rows can create internal candidate IDs and ballot-confirmed candidacies without inventing official person IDs. Their FEC match remains unresolved. FEC discoveries are retained independently; an unlinked registration does not allocate a duplicate person alongside a state ballot candidate. Once an official source supplies a FEC ID, or an operator records supported resolution evidence, the connection can be established. A shared committee or matching name alone never merges people.

An unchanged exact source record reuses its existing internal person across snapshots. Changed rows that collide with a same-race candidate name remain unresolved until explicit evidence selects the existing person or establishes a distinct new person. Evidence row locators and hashes are not inserted into the official person-identity table. Resolutions are immutable: contradictory reassignment is rejected rather than silently moving history.

Candidate/race promotion and its resolution commit atomically per observation. Document/extraction batches also commit atomically. Network and model calls occur outside these transactions. A partially processed run may preserve successful observations/promotions and must report partial/failed status; it does not pretend the entire nationwide run committed atomically.

## Ballot extraction and confirmation

The reviewed source descriptor fixes authority, state, allowed origins, election scope and race mappings. The model cannot choose or approve that descriptor. Wyoming maps the two federal office labels to at-large House district `0` and Senate class `2`, with November 3, 2026/general/regular classification grounded in the saved official calendar/office evidence. This is not an electoral-boundary audit.

CSV uses `csv-parse` with quoting/newline handling and required columns. PDF uses bounded local text extraction from saved bytes; HTML removes scripts/navigation and retains readable text. Unsupported, empty, oversized, or malformed inputs fail explicitly. Scanned/image-only PDFs require further work; no OCR is claimed. A document is limited to 4 MB, extracted text to 300,000 characters, PDF processing to 100 pages, and AI input text to 100,000 characters. Documents exceeding these limits are retained where possible and reported as failures rather than truncated into apparent complete coverage.

For AI sources, `ballotExtraction.md` proposes structured rows with inclusive numbered evidence lines; the server copies the source excerpt verbatim. The prompt version is now `ballot-v3`. `ballotVerification.md` independently checks each row. Code additionally requires exact source excerpts, supported names/parties/websites/IDs, an allowed race, and explicit withdrawal/disqualification evidence. Unsupported or ambiguous results are stored as invalid/needs-review and cannot promote. A source-wide withdrawal instruction is insufficient evidence that a particular candidate withdrew. Structural/AI checks are not perfect semantic fact checking; compare a bounded live sample with original sources before accepting new coverage.

The three independent facts are ballot eligibility, source-identity matching, and campaign-site verification. Missing FEC IDs or websites do not erase official ballot evidence. A newer retrieval of an older effective document cannot undo a later withdrawal. Returning from withdrawn/disqualified to ballot-confirmed requires explicit reinstatement evidence; an ordinary list refresh is insufficient. Equal-dated conflicting eligibility does not overwrite the prior state. Absence, empty AI output, partial pagination and failed requests never imply withdrawal.

## Sites and network rules

The worker saves official ballot-linked websites as proposed/missing. With `--verify-sites`, it fetches only the proposed HTTPS origin, excludes known donation/social platforms, and requires candidate-name and federal-office consistency on the returned HTML before saving approval, source evidence, approved path/origin and a seven-day review deadline. Redirects to another origin remain unapproved until separately reviewed; `www` is not automatically approved. This conservative check can leave legitimate sites proposed or ambiguous. There is no bypass of blocked pages or JavaScript challenge pages.

Each request resolves DNS, rejects non-public addresses, and pins the checked address into the TLS connection. DNS/request timeouts, response sizes, retry counts and redirect counts are bounded. Long rate-limit waits end the bounded run instead of retrying earlier than the provider permits. Request headers containing API credentials do not follow a cross-origin redirect. Source URLs containing credential-like query parameters are rejected. Logs emit machine codes, not raw provider exceptions, headers or connection strings.

Repeated checks reuse an unexpired identical site verification. Ordinary discovery and a transient network failure preserve an existing verified site with the same destination. An explicitly changed/missing destination after supported identity resolution can create a new site revision and revoke old crawl eligibility while preserving old snapshots and responses. FEC committee website proposals are retained as separate observations; they do not automatically override a state-linked site or prove a cross-source person match. Campaign crawling and AI policy extraction remain step 4 work.

## Coverage and operational boundaries

Wyoming remains a partial adapter. The subsequent [nationwide onboarding pass](elections-onboarding.md) searched all 50 states and inspected DE/ND/MO/NH/NE. DE/MO/NH/NE yielded 54 independently compared valid observations; ND requires form-based retrieval. Forty-four states returned URL proposals, with six search gaps. These are bounded extraction results; nationwide and production acceptance remain open.

Run summaries distinguish complete, partial, failed and unsupported per state/office, with race results, source results, FEC status and safe errors. Counts are work processed in the run, not a count of new unique database rows. A committee cap or incomplete FEC page sequence prevents full FEC success. A source may report complete only when its reviewed descriptor explicitly has `completeness:"complete"`, `coverageAccepted:true`, and `correctionsAudited:true`, with valid promoted rows for that office. Setting these flags requires actual coverage evidence, not an AI assertion.

An empty office can be complete only through explicit reviewed `noRaces` proof: `{office,excerpt,reviewedBy,checkedAt}` in the source descriptor, with the exact proof excerpt present in the captured official document and no conflicting race mapping. Empty model output alone remains partial. The fixture that tests this mechanism is invented and explicitly does not establish that Wyoming lacks a Senate race.

Approved origins and race mappings for new states require source research. A source descriptor is an array entry with `id`, `state`, `format` (`wy-csv`, `mapped-csv`, or `ai`), `authoritative:true`, `url`, `allowedOrigins`, `authorityUrl`, `checkedAt`, `effectiveAt` when supplied by the source, `completeness`, and `races:[{label,race}]`. `race` uses the shared contract. `sources/wyoming.js` is the executable example. Keep an authority link and saved date/seat evidence with each mapping. Do not promote generated search output directly into this descriptor.

## Commands

Run from the repository root. First, inspect the stored sample without credentials, network, or database writes:

```powershell
npm.cmd --prefix server run elections:discover -- --inspect-fixture
```

Expected: six records, six valid rows, five proposed websites, partial coverage and `databaseWrites:false`.

Read-only AI source research, using the existing server key (provider requests can incur usage charges):

```powershell
npm.cmd --prefix server run elections:discover -- --search-sources --states WY --checkpoint ..\election-source-proposals-WY.json
```

This writes a local proposal report, refuses to overwrite an existing output file, and makes no database writes. It does not approve sources. A bounded live Wyoming search returned the official election center and general candidate PDF; this is recorded in `live-source-search.json`. It does not establish nationwide search quality or approve generated source descriptors.

After the additive migration is accepted for a chosen development database, this command **writes to that database's configured `DATABASE_URL`**. It does not apply migrations:

```powershell
npm.cmd --prefix server run elections:discover -- --write --states WY --skip-fec
```

Remove `--skip-fec` when a private `FEC_API_KEY` is configured in the server environment. Do not put keys in command arguments. Add `--verify-sites` for bounded campaign-homepage verification, or `--sources path.json` for another reviewed descriptor array. Explicit states are required. Defaults are 100 FEC pages and 100 candidate-committee lookups per state/office; `--max-pages` and `--max-committees` narrow these bounds. Exit code `0` means complete, `2` means partial/failed/unsupported summary, and `1` means a command-level error. A useful partial import intentionally returns `2`.

For a changed ambiguous row, the command supports `--resolve-observation`, `--candidate-id`, `--actor`, `--evidence-url`, and `--reason` with `--write`. Use `--new-person` instead of `--candidate-id` only when evidence establishes a distinct person. Resolution requires a valid observation and documented evidence; it cannot force an invalid AI row into a confirmed candidate. IDs come from the saved observation/candidate records. This is a server/operator tool, not a public identity override API.

## Verification recorded

- Offline fixture extraction passed: six federal rows/five proposed sites.
- All 39 focused election checks passed after the onboarding expansion. Disposable PostgreSQL tests apply both exact migrations and exercise state-only promotion, repeated imports, immutable evidence, site revisions, FEC separation/linking, explicit withdrawal/older-source handling, partial-source failures, no-race proof, AI validation retries, browser-role denials and rollback. Existing legislative/storage tests remain covered.
- A bounded live OpenAI `gpt-5.4` extraction plus independent verification read the saved official Wyoming CSV. All six resulting records matched deterministic extraction for name, party, race, IDs, site and eligibility; supporting excerpts occurred in the captured source. See `live-ai-ballot-check.json` in the dated fixture directory. This was a live model check on a saved source, not a fresh nationwide import or campaign-policy validation.
- The new public HTTP client fetched the live Wyoming CSV successfully (HTTP 200, 31,030 bytes) on October 26, 2026. No database writes occurred during that check.
- The full `test:all` run passed Deno notification tests, client lint and the client build, but failed in the existing live Senate menu/vote XML tests (`senate-vote-parse.test.mjs`). Do not report the full suite as green. No Senate parser change is included.

Recheck locally:

```powershell
node scripts/verify-election-source-research.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File tests/run-postgres-tests.ps1 -TestFile "elections*.test.mjs"
npm.cmd run test:all
git diff --check
```

Source research remains in [elections-sources.md](elections-sources.md), with active coverage in [the inventory](elections-source-inventory.json). Production permissions, all-state source acceptance, House election geography, nationwide source-search acceptance, real campaign-site samples, scheduling, and the later API/UI are separate outstanding work.

## Nationwide onboarding extension

See [elections-onboarding.md](elections-onboarding.md) for the current persistent checklist, exact search/inspection/resume/report commands, independently compared snapshot counts, retrieval gaps, and offline verification. `mapped-csv` descriptors supply reviewed `csv.columns` (name, office, optional party/website/IDs/status), an exact election `csv.filter` and explicit `csv.statuses`; unknown statuses remain review-only. The real Wyoming mapping example is saved with the onboarding fixtures. Search and inspection checkpoint scope/model/source metadata, refuse overwrites, and never write the DB. Production imports still require the explicit `--write` path.
