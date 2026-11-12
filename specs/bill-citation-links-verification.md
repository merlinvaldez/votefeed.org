# Bill citation links — November 12, 2026

Official-summary citations now open a new tab in both feed cards and bill details.
The existing Read Full Bill Text link already used a new tab.

The shared OfficialSummary component sets `target="_blank"` and `rel="noopener"`
after every render. Running only when the HTML string changed was insufficient:
React could reassign innerHTML on another render and clear the added attributes.
The live click check reproduced that case and verified the correction.

- Production frontend: `dpl_6WqEx6CDswVabS8feZ41kcoi11fQ`, READY.
- Dev frontend: `dpl_GoKX2grR6QhxGEKvw8sbZzgL1qoT`, READY; elections dev alias updated.
- Both frontend builds and four targeted rendering/availability checks passed.
- Browser inspection confirmed citation anchors on production H.R. 1 have the
  new-tab target and noopener relation after the page has updated.
- Clicking a real Congress CRS citation opened a second tab. The original H.R. 1
  page remained open at its original URL. Congress presented its own browser
  challenge in the second tab; this did not affect tab-opening verification.

To verify: open a bill with citations in its official summary, then click one.
VoteFeed should stay open and the cited source should appear in a separate tab.
