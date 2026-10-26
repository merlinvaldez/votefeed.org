# Elections source research

Step 3.1 evidence, checked October 26, 2026. Scope remains the 2026 regular U.S. House/Senate general elections in all 50 states. This research makes no database writes and implements no import or campaign crawler.

Later implementation update on the same date: [the discovery worker](elections-discovery.md) now resolves the sample observation-storage dependency and implements bounded Wyoming/FEC discovery, AI ballot extraction/verification and site checks. This document preserves the original research findings below; the active JSON inventory now records partial WY/DE/MO/NH/NE coverage and ND retrieval gaps. See the subsequent [nationwide onboarding evidence](elections-onboarding.md). Statements below about not-yet-implemented adapters or the open storage gate describe the research snapshot, not the current local implementation. No production migration/import is implied.

The [machine-readable inventory](elections-source-inventory.json) contains 50 states and 100 state/office entries. Authorities and directory URLs come from the [FEC state election offices directory](https://www.fec.gov/introduction-campaign-finance/how-to-research-public-records/state-election-offices/). Wyoming is a locally tested partial adapter; a later five-state inspection adds bounded DE/MO/NH/NE extraction acceptance and an ND form-retrieval gap. All 50 states have recorded search outcomes; other artifacts remain unreviewed/unsupported. Directory links alone do not establish 2026 ballot coverage. No production import has been applied. Null means unknown, never no election.

## Evidence and reproducibility

Original responses are saved under [the dated fixture directory](../tests/fixtures/elections/discovery/2026-10-26/manifest.json). The manifest records requested URLs without authentication parameters, HTTP status, response date, content type, byte count, SHA-256, and available rate-limit/last-modified headers. Derived artifacts separately record their source files and hashes. Captured HTML may contain relative links; consult the manifest's source URL when following them.

Requests were read-only, limited to known public official URLs, used 25-second timeouts and a 4 MB response ceiling, and did not retry or bypass inaccessible sites. The FEC probe used the public demonstration key in an HTTP header; no private credentials were read or saved. API requests were sequential. State/documentation captures used at most four concurrent requests. An exploratory Alaska request failed before fixture capture; Alaska remains unsupported and is not part of the selected sample. Search results alone were not used to establish ballot facts.

Run this offline integrity/consistency check from the repository root:

```powershell
node scripts/verify-election-source-research.mjs
git diff --check
```

The check validates the inventory against the release state list, fixture hashes, sampled pagination, and the six derived Wyoming observations. It does not refresh sources, certify candidates, verify campaign ownership, or prove nationwide coverage. Refreshing evidence later must use a new dated directory rather than overwrite these captures.

## OpenFEC: selected discovery adapter

Official references: [OpenFEC developer documentation](https://api.open.fec.gov/developers/), [live Swagger schema](https://api.open.fec.gov/swagger/), and [api.data.gov developer manual](https://api.data.gov/docs/developer-manual/). Captures include the full Swagger schema and actual candidate, committee, and filing responses.

| Endpoint relative to `https://api.open.fec.gov/v1/` | Inspected behavior and future adapter use |
| --- | --- |
| `candidates/search/` | Filter `election_year=2026`, `state`, `office=H` or `S`; preserve `candidate_id`, name, party, state, district, election years, source dates, and nested principal committee IDs. Registration is discovery only. |
| `candidate/{candidate_id}/committees/` | Filter `cycle=2026`; preserve `committee_id`, `candidate_ids`, designation, source dates, and `website`. The nested principal-committee object in candidate search omits the website field in this capture; fetch the committee endpoint for it. |
| `committee/{committee_id}/` | Confirms the committee record and proposed `website`; preserve its explicit candidate associations without treating committee identity as person identity. |
| `committee/{committee_id}/filings/` | `form_type=F1` yields filing references, amendment metadata, receipt date, `file_number`, `sub_id`, and `html_url`/`pdf_url`/`fec_url`. Preserve these references for verification evidence. Only one filing was sampled; filing-history completeness is not claimed. |

The schema defaults to `page=1`, `per_page=20`. The FEC documentation describes a 100-result page maximum, and a 100-result request succeeded. Actual responses contain `pagination.count`, `page`, `pages`, `per_page`, and `is_count_exact`. Future adapters must read through the reported last page and label interrupted/changing pagination partial rather than infer completeness from the first page. A successful count is FEC discovery coverage, not ballot coverage.

Saved probes:

- Wyoming House pages 1 and 2 at two records per page: 14 total records, seven pages reported, distinct IDs across the two sampled pages. This probe intentionally stops at page 2.
- A separate House request at 100 records per page: all 14 records on one reported page. The four paginated records agree with the start of this response sorted by `candidate_id`.
- Wyoming Senate at 100 records per page: nine records, one reported page. The state general roster contains only two Senate candidates, demonstrating why FEC registration cannot confirm ballot eligibility.
- Candidate `S6WY00209` returns committee `C00788943`, website `WWW.HAGEMANFORWYOMING.COM`, and candidate IDs `H2WY00166` and `S6WY00209`. Preserve this explicit source relationship; do not conclude that a shared committee alone establishes person identity or the current office sought.
- The first Senate record also supplied a committee/filing probe: `S0WY00137` -> `C00443580` -> Form 1 filing `1919372`. This is a source-chain example, not evidence that this person is on the Wyoming general ballot.

Access prerequisite for a real worker: obtain a private api.data.gov/OpenFEC key and keep it server-side, for example in `FEC_API_KEY`. This variable is a proposed configuration name; no worker consumes it yet. The official manual describes a default 1,000 requests/hour for registered keys and demo defaults of 30/hour and 50/day. **The actual FEC responses in this session advertised a stricter limit of 10**, with the last saved response showing one remaining. Use actual service headers and handle HTTP 429 with bounded retries and `Retry-After` when present; do not hardcode the documentation defaults as an entitlement. No 429 or timeout was deliberately induced, and no retry implementation is claimed.

FEC results do not establish the applicable general-election date, Senate class, regular/special classification, or state ballot status. Their `candidate_status` and `candidate_inactive` values must not overwrite state-confirmed eligibility. Names, committee IDs, and campaign domains are not automatic person-merge keys.

## Wyoming: selected state adapter sample

Authority: Wyoming Secretary of State, Elections Division. Its [election center](https://sos.wyo.gov/elections/default.aspx) links the following public artifacts; all saved downloads returned HTTP 200 without login or a private key.

| Purpose | Exact official artifact | Observed format and limits |
| --- | --- | --- |
| Primary candidate source for this adapter | [2026 general candidate data](https://sos.wyo.gov/Elections/Docs/2026/2026_WY_General_Election_Candidates.csv) | CSV, although the landing page labels it an Excel data file. Contains 151 data records, including six federal records. No candidate/FEC IDs. |
| Human cross-check | [General candidate roster](https://sos.wyo.gov/Elections/Docs/2026/2026_WY_General_Election_Candidates.pdf) | 19-page PDF, printed September 9, 2026 at 11:20 AM. Page 1 contains the six federal candidates. No web-address column. Checked visually against CSV names/parties. |
| Election date | [Key election dates](https://sos.wyo.gov/Elections/Docs/2026/2026_Key_Election_Dates.pdf) | One-page PDF; explicitly identifies November 3, 2026 as the general election and August 18 as the primary. Visually checked. |
| Deadlines and withdrawal rules | [2025–2026 election calendar](https://sos.wyo.gov/Elections/Docs/2026/2026_Election_Calendar.pdf) | 17-page PDF; use its dated withdrawal/certification events as process context, not evidence that an individual withdrew. Extracted text retains page boundaries. |
| Federal versus state office classification | [Offices up for election](https://sos.wyo.gov/Elections/Docs/2026/2026_Offices_Up_for_Election.pdf) | One-page PDF; distinguishes federal offices from state legislative offices, including a state Senate unexpired-term contest that is outside this release. Visually checked. |
| Corrections discovery | [Secretary of State media releases](https://sos.wyo.gov/Media/MediaReleases.aspx) | Official discovery page inspected through web access. No separate general-election correction/withdrawal feed was established; `correctionsUrl` remains null. A primary-withdrawal roster linked on the election center is not a general-election removal source. |

Selected adapter: a Wyoming-specific CSV parser plus calendar/office evidence. Do not parse the PDF instead of the CSV or invent a nationwide generic state JSON endpoint. Snapshot the entire original CSV before selecting federal rows. Its records use quoted fields and CR-CR-LF line endings; parse as CSV with newline handling, not line/comma splitting.

### Field and reconciliation rules established by inspection

| Required fact | Source field/evidence and rule |
| --- | --- |
| Scope | Accept `Election` exactly `2026 GENERAL ELECTION`; this does not grant eligibility to similarly named primary records. |
| Office | Accept `Office Sought` exactly `UNITED STATES SENATOR` or `UNITED STATES REPRESENTATIVE`. Exclude governor, `STATE SENATOR`, `STATE REPRESENTATIVE`, and all other offices. |
| Candidate display | Preserve `Ballot Name` and the separate first/middle/last/suffix fields. Neither spelling nor row number establishes a persistent person identity. |
| Party | Preserve source codes `REP`, `DEM`, `LBR`, `CT`; the PDF prints Republican, Democratic, Libertarian, Constitution for the corresponding federal rows. Preserve raw values with any normalized display. |
| Geography | Authority establishes state `WY`. House district `0` is the proposed at-large mapping; the inspected FEC House records corroborate district `00`. This is representation normalization, not verified 2026 electoral-boundary evidence. House location reads remain gated under step 1/3.2. |
| Senate class | CSV does not supply it. Supplement the state office/ballot evidence with the [official Senate Class II list](https://www.senate.gov/senators/Class_II.htm), captured locally, which places Wyoming's expiring seat in class 2. Never use senior/junior or current-member lookup to discover candidates. |
| Date/stage/type | State key-dates document supplies `2026-11-03` and general stage. The federal offices sheet lists full six-/two-year terms, supporting regular-contest classification for the sample. Do not apply this mapping to a future special roster. |
| Ballot observation | Listing in this official general roster supports a dated state ballot observation. The September print date and unknown corrections coverage do not certify that no later eligibility changes exist. Preserve retrieval date separately from artifact effective/printed date. |
| Withdrawal | `Date Withdrawn` is present. All six federal entries and all 151 data records are blank in the capture; there is no real withdrawal-positive fixture here. A future nonblank dated value can support an explicit update; missing rows or blank fields cannot reverse prior withdrawal/disqualification. |
| Website | `Web Address` supplies five proposed federal sites; one is missing. Preserve raw field and source locator. A bare uppercase hostname needs scheme/host normalization before a future request; adding HTTPS does not verify ownership or approve redirects. Email domains are not substitutes for missing sites. |
| Identity | No official candidate ID, FEC ID, or explicit FEC cross-reference is supplied. Save an artifact hash + data-row locator as evidence only. Cross-source person matching remains unresolved; do not merge by ballot name, party, email, or URL. |

### Bounded sample and website evidence

The derived [six federal observations](../tests/fixtures/elections/discovery/2026-10-26/wy-federal-observations.json) retain their raw CSV records and exact artifact/data-row locators. They are research fixtures, explicitly marked `notImportReady`; proposed races are not persisted database facts.

| Office | Ballot name | Party | Raw official website field |
| --- | --- | --- | --- |
| Senate | Harriet Hageman | REP | `HAGEMANFORWYOMING.COM` |
| Senate | James Byrd | DEM | `BYRDFORSENATE.COM` |
| House, at-large | Chuck Gray | REP | `CHUCKFORWYOMING.COM` |
| House, at-large | Lisa Kinney | DEM | `LISAKINNEYFORCONGRESS.COM` |
| House, at-large | Shawn Johnson | LBR | Empty: missing site |
| House, at-large | Jeffrey Haggit | CT | `HAGGITFORHOUSE.COM` |

The state website column is a useful ownership-evidence source tied to an official ballot row. The FEC Hageman committee website corroborates one proposed domain but does not resolve the state-to-FEC person match automatically. Step 3.4 still needs identity/race consistency, actual destination checks, explicit approved origins/path prefixes, evidence, verifier version, checked-at time, and review deadline before verification. No campaign page was fetched and no site was marked verified during 3.1.

## Dependency decision and readiness

The bounded sample's storage-readiness gate is now closed by [the local discovery implementation](elections-discovery.md). The worker retains immutable observations and can create internally identified state-only candidacies without requiring a FEC match. The original six-row research JSON remains a historical derived sample, not the worker's input; the worker reads the original CSV.

Remaining dependencies are explicit:

1. Changed/ambiguous identities require evidence-backed resolution. Names and artifact row locators do not become official person IDs.
2. General-election correction/disqualification coverage is not accepted. Wyoming's import remains partial; newer retrieval of older evidence cannot undo withdrawal.
3. The other 49 states need reviewed sources and coverage acceptance. The generic AI reader and source-search proposals do not establish nationwide completeness.
4. House location reads remain gated on verified election geography. Campaign crawling/policy extraction, production migration/permissions, scheduling, and later API/UI remain separate work.

The bounded live source search found Wyoming's official election center and general candidate PDF. This verifies one state's proposal search, not nationwide coverage. No paid election-data vendor was introduced.

## State inventory index

All rows cover House and Senate. Directory-listed authorities are not proof of a working state adapter. Exact artifact URLs, access findings, dates, and limitations are in the JSON inventory linked above.

| State | Official authority entry point | Research / adapter coverage |
| --- | --- | --- |
| AL | [Alabama](https://www.sos.alabama.gov/alabama-votes) | Unresearched / unsupported |
| AK | [Alaska](https://www.elections.alaska.gov/) | Unresearched / unsupported |
| AZ | [Arizona](https://azsos.gov/elections) | Unresearched / unsupported |
| AR | [Arkansas](https://www.sos.arkansas.gov/elections) | Unresearched / unsupported |
| CA | [California](https://www.sos.ca.gov/elections) | Unresearched / unsupported |
| CO | [Colorado](https://www.sos.state.co.us/pubs/elections/main.html) | Unresearched / unsupported |
| CT | [Connecticut](https://portal.ct.gov/en/SOTS/Common-Elements/V5-Template---Redesign/Elections--Voting--Home-Page) | Unresearched / unsupported |
| DE | [Delaware](https://elections.delaware.gov/) | Unresearched / unsupported |
| FL | [Florida](https://dos.myflorida.com/elections/) | Unresearched / unsupported |
| GA | [Georgia](https://sos.ga.gov/index.php/elections) | Unresearched / unsupported |
| HI | [Hawaii](https://elections.hawaii.gov/) | Unresearched / unsupported |
| ID | [Idaho](https://sos.idaho.gov/elections-division/) | Unresearched / unsupported |
| IL | [Illinois](https://www.elections.il.gov/) | Unresearched / unsupported |
| IN | [Indiana](https://www.in.gov/sos/elections/) | Unresearched / unsupported |
| IA | [Iowa](https://sos.iowa.gov/) | Unresearched / unsupported |
| KS | [Kansas](https://www.sos.ks.gov/) | Unresearched / unsupported |
| KY | [Kentucky](https://www.sos.ky.gov/Pages/default.aspx) | Unresearched / unsupported |
| LA | [Louisiana](https://www.sos.la.gov/ElectionsAndVoting/Pages/default.aspx) | Unresearched / unsupported |
| ME | [Maine](https://www.maine.gov/sos/cec/elec/index.html) | Unresearched / unsupported |
| MD | [Maryland](https://www.elections.maryland.gov/) | Unresearched / unsupported |
| MA | [Massachusetts](https://www.sec.state.ma.us/ele/eleidx.htm) | Unresearched / unsupported |
| MI | [Michigan](https://www.michigan.gov/sos/0,4670,7-127-1633---,00.html) | Unresearched / unsupported |
| MN | [Minnesota](https://www.sos.state.mn.us/elections-voting/) | Unresearched / unsupported |
| MS | [Mississippi](https://www.sos.ms.gov/index.php/elections-voting) | Unresearched / unsupported |
| MO | [Missouri](https://www.sos.mo.gov/elections/) | Unresearched / unsupported |
| MT | [Montana](https://sosmt.gov/elections/) | Unresearched / unsupported |
| NE | [Nebraska](https://sos.nebraska.gov/index) | Unresearched / unsupported |
| NV | [Nevada](https://www.nvsos.gov/sos/elections) | Unresearched / unsupported |
| NH | [New Hampshire](https://sos.nh.gov/) | Unresearched / unsupported |
| NJ | [New Jersey](https://www.state.nj.us/state/elections/index.shtml) | Unresearched / unsupported |
| NM | [New Mexico](https://www.sos.state.nm.us/) | Unresearched / unsupported |
| NY | [New York](https://www.elections.ny.gov/) | Unresearched / unsupported |
| NC | [North Carolina](https://www.ncsbe.gov/) | Unresearched / unsupported |
| ND | [North Dakota](http://sos.nd.gov/elections) | Unresearched / unsupported |
| OH | [Ohio](https://www.sos.state.oh.us/elections/) | Unresearched / unsupported |
| OK | [Oklahoma](https://oklahoma.gov/elections.html) | Unresearched / unsupported |
| OR | [Oregon](https://sos.oregon.gov/voting-elections/Pages/default.aspx) | Unresearched / unsupported |
| PA | [Pennsylvania](https://www.dos.pa.gov/VotingElections/Pages/default.aspx) | Unresearched / unsupported |
| RI | [Rhode Island](https://vote.sos.ri.gov/) | Unresearched / unsupported |
| SC | [South Carolina](https://www.scvotes.gov/) | Unresearched / unsupported |
| SD | [South Dakota](https://sdsos.gov/elections-voting/default.aspx) | Unresearched / unsupported |
| TN | [Tennessee](https://sos.tn.gov/elections) | Unresearched / unsupported |
| TX | [Texas](https://www.sos.state.tx.us/elections/index.shtml) | Unresearched / unsupported |
| UT | [Utah](https://vote.utah.gov/) | Unresearched / unsupported |
| VT | [Vermont](https://sos.vermont.gov/elections/) | Unresearched / unsupported |
| VA | [Virginia](https://www.elections.virginia.gov/) | Unresearched / unsupported |
| WA | [Washington](https://www.sos.wa.gov/elections/) | Unresearched / unsupported |
| WV | [West Virginia](https://sos.wv.gov/elections/Pages/default.aspx) | Unresearched / unsupported |
| WI | [Wisconsin](https://elections.wi.gov/) | Unresearched / unsupported |
| WY | [Wyoming](https://sos.wyo.gov/Elections/Default.aspx) | Sample inspected / partial |
