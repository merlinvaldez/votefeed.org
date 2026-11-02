# 2026 Selected-State Campaign Site Completeness Database

This is the consolidated ballot-first dataset for the selected 2026 U.S. House and Senate races in California, Massachusetts, New Jersey, New York, Ohio, and Pennsylvania. Florida is excluded. The 305-record research cohort includes seven Ohio valid write-in candidates; they are retained for completeness but are not displayed as named ballot choices.

## Canonical local files

- `elections_2026_ca_pa_oh_ma_nj_ny_ballot_first_site_research.sqlite` is the single local research database. It has one canonical row per included candidate, official ballot evidence, campaign homepage review and search history, issue review status, issue pages, and extracted positions.
- `elections_2026_ca_pa_oh_ma_nj_ny_ballot_first_site_completeness.csv` has one row per included candidate and carries each record's source, crosswalk, site-review, and issue-review trail. Nested JSON fields preserve the per-candidate evidence arrays.

The prior five-state and New York SQLite/CSV files remain as source snapshots. Use the consolidated files above for this six-state cohort.

## Cohort and coverage

| State | House | Senate | Candidates |
|---|---:|---:|---:|
| California | 104 | 0 | 104 |
| Massachusetts | 17 | 4 | 21 |
| New Jersey | 35 | 4 | 39 |
| New York | 59 | 0 | 59 |
| Ohio | 41 | 7 | 48 |
| Pennsylvania | 34 | 0 | 34 |
| **Total** | **290** | **15** | **305** |

Ohio's U.S. Senate race is a special election for the unexpired term ending January 3, 2029. The Ohio Secretary of State's [Directive 2025-54](https://www.ohiosos.gov/globalassets/elections/directives/2025/directive-2025-54---writ-of-special-election-for-united-states-senate-election.pdf) establishes the November 3, 2026 special election; the race is stored as Senate seat class III.

The cohort has 292 verified campaign sites, 11 searches with no site verified, and 2 sites whose homepages were unreachable during review. It contains 396 issue-page records and 904 issue-position records: 881 ready positions and 23 retained for review.

## Frontend display rule

The frontend displays the **298 candidates with named ballot entries**. Seven Ohio candidates are listed by the state as valid write-ins, so voters may write in their names but those names are not printed choices. They remain in the CSV and SQLite research records with `frontend_display_status=write-in-only`; the app database stores their candidacies as `filed`, so they are excluded by the ballot-confirmed roster/feed filter.

## Database and frontend

The canonical app data is PostgreSQL. `scripts/import-ballot-first-research-to-votefeed.mjs` defaults to a read-only preflight and imports the consolidated local dataset to local PostgreSQL and VoteFeed Dev only when run with `--apply`. It refuses to target the production project.

The server roster and campaign feed now require `eligibility='ballot-confirmed'`. The client also drops roster records without that exact state-confirmed value. FEC registration alone does not make a candidate visible. Special general-election contests are included when their candidacy is ballot-confirmed. Review-marked issue positions remain stored as withheld and do not appear in the feed.

The current app database contains this ballot-confirmed cohort in the six states above. Other nationwide FEC records remain in the database but stay hidden until state ballot evidence is imported.
