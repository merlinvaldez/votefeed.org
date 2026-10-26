# Read-only discovery research fixtures

Captured for elections step 3.1 on October 26, 2026. These are real public official-source responses, not invented adapter/model fixtures or a production import.

Implementation update: the worker now imports this sample in disposable-database tests. The original research observations remain unchanged; the active inventory marks Wyoming partial and the other 49 states unsupported. `live-ai-ballot-check.json` records a live model extraction/verification check against the saved CSV, with no database writes. `live-source-search.json` records a bounded Wyoming source search that returned official source proposals. These additions do not establish nationwide or production acceptance.

- `manifest.json` lists source URLs, HTTP metadata, byte counts, hashes, and derived-artifact provenance. Authentication is excluded from request URLs; the public FEC demo key was passed in a header. No private key was used.
- `fec-wy-house-page-{1,2}.json` samples two of seven small pages. `fec-wy-house-complete.json` separately contains all 14 returned House discoveries on one large page. `fec-wy-senate.json` contains nine discoveries on one page. These counts describe FEC results, not candidates on the ballot.
- Committee and filing captures demonstrate source associations and website/filing fields. They do not establish state ballot access or authorize campaign crawling.
- `wy-general-candidates.csv` is the raw official export. Despite the landing page's Excel label, it is CSV. The PDF roster is a visual cross-check. Other PDFs and extracted texts document election date, office types, and calendar context.
- `wy-federal-observations.json` is a derived six-row research sample with raw fields, proposed races, and exact artifact/data-row locators. Official person IDs and FEC matches remain null; locators must not become person IDs. No site is verified.
- The original PDF roster's printed date is September 9, 2026; retrieval on October 26 is not proof that the artifact incorporates every correction. No separate general-election corrections/disqualification feed was established.
- The active inventory marks Wyoming partial. The other 49 states have authority-directory entries only and remain unsupported.

See [the research document](../../../../../specs/elections-sources.md) for parsing rules, limitations, and the step 3.2 storage dependency.

Offline verification from the repository root:

```powershell
node scripts/verify-election-source-research.mjs
```

Refreshing live evidence should create a new dated directory, preserving these samples. The offline check makes no network/database requests.
