# Desired user behavior

The future Elections feed shows people candidates for their House district and Senate races, with concise policy positions grounded in campaign websites. FEC registration is not proof of ballot access; do not present this as a definitive ballot. Loading, no available positions, and failed processing must be distinguishable. Source links and retrieval dates accompany positions.

# Implementation steps

## 1. Discover candidates and campaign sites from FEC

- [x] Implement scoped 2026 House and regular Senate FEC candidate and committee discovery, pagination, source evidence and candidate identity handling locally.
- [x] Collect proposed campaign websites and check ownership before allowing a crawl. Verification requires an explicitly enabled discovery option.
- [ ] Verify the FEC-only import and site verification with a bounded live sample and disposable database. Confirm nationwide coverage and report partial failures.
- [ ] Verify 2026 House election geography before matching candidates to a user's district.

## 2. Crawl verified campaign sites with Crawlee

- [x] Implement a server-side crawler, bounded requests, public destination checks, text cleaning and saved source snapshots locally.
- [ ] Verify a small live sample of actual campaign sites, including inaccessible and empty sites.

## 3. Generate structured data with AI

- [x] Implement campaign-position extraction, source-excerpt validation and database publication/versioning locally. Database storage and read functions exist.
- [ ] Manually compare all generated positions in the live sample with their source text and verify semantic accuracy.
- [ ] Confirm deployed database permissions and migration acceptance. Local checks do not establish production acceptance.

## Later delivery

- [ ] Implement the feed API and Elections tab, including matching geography, loading, empty and error states, and browser acceptance.
- [ ] Decide hosting, scheduling and initial import; deploy and verify separately.

No production deployment, import, or schedule is claimed. Existing local fixture evidence is documented in [elections-crawl.md](elections-crawl.md); its historical references to state discovery do not describe the current scope.

# How to check it works

- [ ] Run the FEC-only discovery twice on a bounded scope and confirm stable identities, proposed sites, and clear partial-failure reporting.
- [ ] Verify candidate/site ownership and ensure unverified sites are not crawled.
- [ ] Crawl a small live sample and compare every generated position and excerpt to the saved source.
- [ ] Confirm failed refreshes preserve earlier published content and changed claims preserve prior responses.
- [ ] Verify location matching, production permissions, and the later API and UI separately.
