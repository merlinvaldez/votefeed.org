# 2026 New York Campaign Site Completeness Dataset

## Scope and source of truth

This dataset measures **campaign-site completeness and campaign issue coverage** for New York candidates in the November 3, 2026 federal general election. The official state ballot certification defines the starting candidate roster. Ballot status is used to scope the cohort; the project does not assess ballot validity.

The New York State Board of Elections (NYSBOE) amended candidate certification, dated 2026-10-07, lists candidates for U.S. House districts 1?26. The certification of offices to be filled, dated 2026-07-31, lists no U.S. Senate race for New York in 2026. New York State Senate is a separate state office and is outside this federal dataset.

- [NYSBOE amended certification for the November 3, 2026 General Election](https://elections.ny.gov/certification-november-3-2026-general-election)
- [NYSBOE certification of offices to be filled](https://elections.ny.gov/certification-offices-be-filled-november-3-2026-general-election)

The candidate certification yields **59 distinct House candidates** across districts 1?26. Party-line/fusion details are retained in each candidate's source excerpt; the official roster is one row per candidate, while FEC party codes are kept separately and are not treated as the candidate's complete ballot-line listing. Each official roster row stores the source URL, title, retrieval date, PDF page reference, excerpt, and source limitations. The linked NYSBOE source is recorded in the database; the PDF is not bundled locally.

## Three-step workflow

1. **Build the roster from the state certification.** Record each distinct certified NY House candidate, district, source page, and supporting excerpt. Confirm which federal offices appear in the NYSBOE offices certification.
2. **Crosswalk the certified names to FEC records.** Match by candidate name, U.S. House office, and district. All 59 certified candidates have an FEC identity crosswalk. FEC IDs connect the state roster to the saved campaign research; they are not ballot evidence or a substitute for the official roster.
3. **Review campaign-site completeness and issues.** Find and verify campaign sites, inspect homepage signals, then review first-party issue/platform pages and save sourced issue positions. Record search queries, returned sources, rejected or ambiguous site candidates, page status, and review notes for each candidate.

## Current New York results (2026-10-29)

### Certified ballot cohort

- **59** certified U.S. House candidates across districts 1?26; **59** FEC crosswalks.
- **0** U.S. Senate races listed in the 2026 NYSBOE offices certification.
- The wider FEC inventory remains in the database as research context: 221 NY federal records (209 House and 12 Senate). The 150 House records absent from the certified nominee roster are outside the primary 59-candidate cohort; that comparison does not make a claim about write-in candidacies. The 12 FEC Senate records are marked `no_federal_senate_race` because NYSBOE lists no 2026 federal Senate office.

### Campaign websites and homepage completeness

Among the 59 certified House candidates, **57 campaign sites are verified** and **2 have no site verified after the logged searches**. A `not_found` result describes the search evidence; it does not prove that no campaign site exists.

Of the 57 verified sites, the research tool returned readable homepage text for 50. Seven homepage fetches were limited by the tool: four `tool-inaccessible`, two `tool-timeout`, and one `tool-bad-gateway`. These are retrieval outcomes and do not establish that a campaign site is offline.

Homepage indicators below reflect only extracted homepage text and are counted among the 50 readable pages:

- Candidate identity: 50
- Race or district: 36
- Issues section: 37
- Donation or volunteer path: 44
- Contact path: 30
- Paid-for disclaimer: 31

A `1` means the indicator was visible in extracted text, `0` means it was not observed there, and `NULL` means readable text was unavailable. Images or content omitted by the research tool are not counted.

### Issue-page review and extracted positions

For the 59 certified candidates, issue review status is: 47 `processed`, 6 `no-policy`, 3 `unavailable`, 1 `partial`, and 2 `site-not-found`. There are **120 extracted position records**: 119 marked `ready` and 1 marked `review`. The review-marked position is retained for human review because its source page includes CMS editor-template instructions.

`no-policy` means reviewed campaign material did not yield a clear policy position. `unavailable` means a relevant page could not be reviewed or verified in the available research pass. `partial` indicates an incomplete review. `site-not-found` corresponds to the two candidates whose campaign site was not verified. Short source excerpts and researcher summaries are stored with each position; summaries preserve whether a statement is proposed, current, historical, or opposed where the source supports that distinction.

## Files

- `elections_2026_ny_ballot_first_site_completeness.csv` ? **one row per certified candidate (59 rows)**. Each record contains the state source and page evidence, FEC crosswalk, site decision, homepage signals, and issue review. JSON columns retain that candidate's search results, site observations, site review log, issue pages, issue positions, and FEC ballot-review data.
- `elections_2026_ny_ballot_first_site_research.sqlite` ? NY-only database snapshot with 221 NY FEC records and related site, issue, ballot-review, official-roster, and crosswalk tables. It contains no other-state candidate records.
- `elections_2026_site_research.sqlite` ? broader local research database; it includes the NY ballot-first records plus other states' work.
- `elections_2026_ny_site_completeness.csv` and `elections_2026_ny_site_completeness.sqlite` ? earlier FEC-inventory exports retained as historical artifacts. Use the ballot-first CSV and database for the current NY cohort.
- `issue-position-examples-10/` ? ten individual example JSON records and one combined JSON export.

No production migration has been applied.
