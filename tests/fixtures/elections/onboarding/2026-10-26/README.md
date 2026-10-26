# Official-source onboarding captures - October 26, 2026

Public official candidate documents were fetched with the bounded `fetchPublic` client. The `DE/ND/MO/NH/NE.meta.json` files record URLs, retrieval times and HTTP headers; `.raw` files preserve original bytes and `.txt` files preserve extracted text.

`report.json` is the initial prompt-v1 pass. `accepted-reader/report.json` is prompt v2: some party/excerpt changes were still rejected. `line-reader/report.json` is the successful v3 line-selection pass: DE 5, MO 24, NH 8, NE 17 valid observations; ND remains needs-review with zero observations because the initial GET contains form controls rather than candidate results. Earlier reports are historical attempts, not import inputs.

`expected-federal-rows.json` records a separate comparison with the federal source sections. `de-retry.json` records the bounded intermediate status-context check. `mapped-csv` checks a reusable reviewed CSV mapping on the previously captured Wyoming source, rather than claiming a new live retrieval.

All reports are DB-free and partial. No corrections freshness, complete statewide coverage, FEC identity matches, campaign ownership or production acceptance is claimed. The 50-state search checkpoint and reviewed descriptors are in `specs/`. Run `node scripts/verify-election-onboarding.mjs` from the repository root to verify saved hashes, exact evidence and the independent comparison without keys or network calls.
