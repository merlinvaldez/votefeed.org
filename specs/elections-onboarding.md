# Nationwide election source onboarding

Approved implementation, checked locally October 26, 2026. Scope remains the 2026 regular general election for U.S. House and Senate in all 50 states. This work extends step 3; it does not deploy migrations, write production candidates, schedule discovery, or implement step 4 crawling.

## Verified progress

- [x] Search all 50 authority-directory entries, including the remaining 49 states. Save each outcome before reporting progress.
- [x] Isolate state failures, cap concurrent searches at three, lock checkpoint files, save atomically, and resume successful searches without repeating provider calls. Retry failed/empty searches on resume. Reject changed scope/model/authority signatures.
- [x] Keep proposed URLs separate from reviewed source descriptors. Search cannot approve authority, election scope, races, or candidates.
- [x] Provide DB-free source inspection with raw-byte archives, hashes, extracted text, model/prompt versions, validation decisions, per-race counts, partial coverage and safe errors. Inspection also checkpoints and can resume; earlier failed attempts are retained.
- [x] Add a reusable reviewed CSV column/filter/status mapping. Verify it on the existing Wyoming CSV: six valid rows. Unknown statuses require review; absence does not imply withdrawal.
- [x] Inspect a first batch of five new states: DE, ND, MO, NH, NE. Archive all five responses. Independently compare the four successful extractions with their federal source sections: 54 observations, including an explicit withdrawal. Record ND's form-retrieval gap.
- [x] Generate a local 50-state/100-office onboarding report without network, AI or DB calls.
- [ ] Complete ND's form-based candidate retrieval and independently validate its federal rows. A dropdown of candidate names is insufficient race/ballot evidence.
- [ ] Review exact candidate-list endpoints, dates, seat/district mappings and corrections sources for every remaining state; proposals alone are insufficient.
- [ ] Expand in bounded batches, verify whole-list completeness, explicit no-race proof where applicable, corrections/withdrawals, FEC reconciliation and campaign websites.
- [ ] Finish Wyoming's corrections acceptance and House election-geography acceptance. Source extraction does not establish address-to-election-district correctness.
- [ ] Perform development import/repeat-run acceptance for the expanded states, then production migration/permissions/scheduling acceptance separately.

## Evidence and current counts

| Artifact | Meaning |
| --- | --- |
| `elections-source-proposals.json` | Actual all-state search checkpoint: 44 states with same-origin URL proposals; ND failed; NH/NV/NY/PA/WI returned no results under the current origin filter. These are search outcomes, not verified candidate sources. |
| `elections-reviewed-sources.json` | Five bounded reviewed source descriptors, all partial. ND's official landing page links its candidate search; the initial candidate-search GET is not a usable candidate list. |
| `elections-onboarding-coverage.json` | 50-state/100-office gap report combining existing inventory and this inspection. No state is complete. |
| `../tests/fixtures/elections/onboarding/2026-10-26/line-reader/report.json` | Current `gpt-5.4` / `ballot-v3` extraction results, captured URLs/dates/hashes, exact source excerpts and validation decisions. |
| `../tests/fixtures/elections/onboarding/2026-10-26/expected-federal-rows.json` | Independent federal-section enumeration/transcription used to compare names, parties, races, statuses and proposed websites. |
| `../tests/fixtures/elections/onboarding/2026-10-26/mapped-csv/report.json` | Reusable deterministic CSV mapping checked against the archived Wyoming source. |

| State | Format | Observations | Result |
| --- | --- | ---: | --- |
| DE | HTML | 5 | Four qualified candidates and one explicitly withdrawn House candidate; five state-linked website proposals. |
| ND | HTML form | 0 | Needs retrieval work; initial GET includes filters but no candidate-result table. Never interpreted as no candidates or no Senate race. |
| MO | PDF | 24 | Three party sections, eight House districts. No Senate-absence acceptance is claimed. |
| NH | PDF | 8 | Three Senate candidates and five House candidates across two districts. |
| NE | PDF | 17 | Five Senate candidates and twelve House candidates across three districts. |
| WY | CSV mapping check | 6 | Existing archived sample; verifies reusable column/filter/status mapping without AI. |

These counts include observations of withdrawals, not just currently confirmed candidates. FEC matches and campaign destinations were not live-verified in this batch. Snapshot comparison does not establish that no later corrections exist.

The dated directory also retains earlier extraction reports. They show rejected party normalization and reconstructed-whitespace excerpts. Prompt v3 asks for inclusive numbered evidence lines; the server copies the exact excerpt. The independent model check and code evidence checks still apply. No invalid row is promoted by relaxing the validator.

The old FEC authority directory lists ND using HTTP; the search rejects it. Its separately researched HTTPS candidate endpoint is in the reviewed descriptor. Other directory-listed domains may differ from current authority/subdomain/CDN locations. Explicit research can approve those origins; automatic redirects/search results cannot.

## Commands

From the repository root, verify the saved evidence without credentials, network or DB writes:

```powershell
node scripts/verify-election-onboarding.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File tests/run-postgres-tests.ps1 -TestFile "elections*.test.mjs"
```

Resume search gaps using the already authorized server key (provider calls incur usage):

```powershell
npm.cmd --prefix server run elections:discover -- --search-sources --states all --checkpoint ..\specs\elections-source-proposals.json --resume --concurrency 3
```

Inspect reviewed sources into a **new** local archive directory, without database writes:

```powershell
npm.cmd --prefix server run elections:discover -- --inspect-sources --states DE,ND,MO,NH,NE --sources ..\specs\elections-reviewed-sources.json --archive ..\election-source-check
```

This fetches live sources and invokes AI; partial inspection intentionally exits `2`. Reuse the exact command with `--resume` to skip validated samples and retry gaps. Changed descriptors/model/prompt require a new archive directory. Search and inspection refuse accidental checkpoint overwrites. After a hard process termination, confirm no matching process is running before removing its specific `.lock` file (`inspection.lock` inside an archive); never remove another running worker's lock.

Generate an updated offline report to a new output file:

```powershell
npm.cmd --prefix server run elections:discover -- --coverage-report --states all --checkpoint ..\specs\elections-source-proposals.json --sources ..\specs\elections-reviewed-sources.json --inspection ..\tests\fixtures\elections\onboarding\2026-10-26\line-reader\report.json --output ..\election-coverage-check.json
```

Inspection success means every returned observation passed its evidence checks. It does **not** establish that the extractor found every candidate. Source-section comparisons, seat coverage and a corrections audit remain required before complete import acceptance.
