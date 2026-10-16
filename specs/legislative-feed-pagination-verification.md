# Legislative feed pagination browser verification

Verified October 15, 2026 against the local development client and live development API. Scope: Step 7 item 3 only; signed-in response writes and broader Preview acceptance remain separate.

## Browser checks

- Signed-in New York district 13: switching All Reps / House / Senate rapidly leaves the latest chamber selected. All Reps totals 347 cards, House 276, and Senate 71, matching the live API.
- Guest New York district 13: the initial five cards are Senate H.R. 3633, House H.R. 6500, House S. 32, House S. 307, and combined Senate H.R. 6500. The fifth card contains both Gillibrand and Schumer and both portraits.
- Scrolling appends House H.R. 1181, H.R. 139, H.R. 2478, H.R. 6644, and S. 629. These first ten cards match the API's initial and continuation pages in order, with no missing/repeated cards or split Senate group.
- Rapid Health / Finance and Financial Sector selections discard superseded results. During loading, previous cards disappear while same-location controls remain available.
- Senate plus Finance and Financial Sector reaches six cards and removes the scrolling sentinel: combined H.R. 3633; separate Schumer and Gillibrand S. 1582 actions; combined S.J.Res. 13, S.J.Res. 18, and S.J.Res. 28. Combined cards retain both portraits. The policy count is six and the chamber total remains 71.
- Guest location replacement: start a Health request for New York district 13, immediately go back to the lookup, and submit a different public location (Brooklyn Central Library). The resulting roster/feed uses Goldman instead of Espaillat, with no old district cards or old Health filter returning after pending work settles. No saved profile was changed.

## Fix found during acceptance

`Feed.jsx` previously removed the entire Rep Card and policy choices during a filter request, preventing another chamber selection until the request finished. Same-location loading now retains the controls and roster. Cards remain scoped to the exact current request, so old results stay hidden. Changing viewer, location, or navigation does not reuse that roster shell. Loading and error messages appear within the feed; obsolete alignment and warnings stay hidden.

## Checks run

- `node --test tests/feed-pagination.test.mjs tests/delegation-feed-client.test.mjs`: 16 passed, zero failures/skips.
- From `client`: `.\node_modules\.bin\eslint.cmd src/Feed.jsx`: passed.
- From `client`: `npm.cmd run build`: passed. Vite reports the existing `.env` NODE_ENV warning.
- `git diff --check`: passed.

## Repeat manually

Open `/feed`, select All Reps and All policies, and scroll past the fifth card. Confirm the Senate H.R. 6500 pair stays together and the next cards append once. Switch House / Senate / All Reps and Health / Finance quickly; only the final selection should load. In Senate + Finance, expect six cards and no further scrolling sentinel. For location replacement, use a guest session and the address lookup, leaving saved profiles untouched.
