# 2026 Five-State Campaign Site Completeness Dataset

As of October 29, 2026, this scoped dataset covers federal House and Senate candidates in California, Pennsylvania, Ohio, Massachusetts, and New Jersey.

## Files

- `elections_2026_ca_pa_oh_ma_nj_ballot_first_site_research.sqlite` is a standalone SQLite database containing the five-state official candidate rosters, FEC crosswalk evidence, campaign-site reviews, issue-page captures, and extracted positions.
- `elections_2026_ca_pa_oh_ma_nj_ballot_first_site_completeness.csv` has one row per included general-election candidate and records the roster source, crosswalk, campaign-site and homepage review, search/review trail, issue pages, and positions. JSON columns keep the per-candidate evidence arrays. `source_candidate_key` is the stable row identity.

The broad research archive, `elections_2026_site_research.sqlite`, still retains earlier Florida roster research. Use the scoped five-state database for this deliverable; it contains no Florida or New York candidate records. The CSV also excludes Florida and New York.

## Candidate Coverage

| State | House | Senate | CSV records |
|---|---:|---:|---:|
| California | 104 | 0 | 104 |
| Pennsylvania | 34 | 0 | 34 |
| Ohio | 41 | 7 | 48 |
| Massachusetts | 17 | 4 | 21 |
| New Jersey | 35 | 4 | 39 |
| **Total** | **231** | **15** | **246** |

The database preserves ten additional Pennsylvania roster entries marked `excluded_not_on_general_ballot`; they are not part of the 246-record campaign-site completeness cohort. Ohio's roster includes official sample-ballot and valid-write-in entries, identified by their status in the CSV and database.

All 246 included records have a homepage review and an issue-review status. Issue status totals are 178 processed, 29 partial, 17 no-policy, 9 site-not-found, and 13 unavailable. The database contains 330 issue-page records and 784 position records.

| State | Processed | Partial | No policy | Site not found | Unavailable |
|---|---:|---:|---:|---:|---:|
| California | 73 | 21 | 5 | 1 | 4 |
| Pennsylvania | 24 | 0 | 7 | 0 | 3 |
| Ohio | 32 | 3 | 5 | 5 | 3 |
| Massachusetts | 16 | 4 | 0 | 1 | 0 |
| New Jersey | 33 | 1 | 0 | 2 | 3 |
| **Total** | **178** | **29** | **17** | **9** | **13** |

## Method

1. Start with each state's official general-election candidate list, sample-ballot list, or valid-write-in source. Each row carries the official source URL, title, retrieval date, source page when available, source excerpt, and limitations.
2. Crosswalk official candidate names, offices, and districts to FEC candidate records where possible. Multiple or ambiguous FEC IDs are preserved in JSON fields instead of being silently merged.
3. Review the campaign site's candidate and race identity, visible issue navigation, ways to donate or volunteer, contact path, and paid-for disclaimer.
4. Search the campaign domain for issue/platform pages, record the discovery method and query, and extract positions only when supported by campaign text. Preserve source URL, excerpt, topic, summary, and review notes with each position.

`processed` means substantive positions were extracted; `partial` means accessible material was incomplete or limited; `no-policy` means reviewed campaign material did not contain a substantive policy position; `site-not-found` means no campaign site was verified; `unavailable` records a retrieval limitation and does not prove a site is offline.

The `full_text` page field is a direct text capture where available and a compact evidence summary where retrieval was limited. Position excerpts are stored separately with their source page URLs; the database does not represent a guaranteed raw HTML archive. Homepage checks likewise reflect retrieved page content, and fetch failures are not treated as proof that a campaign site does not exist.

No remote database migration has been performed. The scoped database and CSV are local reviewable deliverables.
