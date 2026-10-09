# Rep Card: Saved Stances and Alignment Trace

Completed scope: all of step 2 of [the chamber-filter checklist](rep-card-chamber-filter-checklist.md). The original source trace below records the pre-integration behavior; the following implementation status supersedes its statements about unchanged runtime paths.

## Integrated runtime status

`getDelegationAlignment` now returns House, Senate, and All Reps summaries in `byChamber`, with per-member and combined agreement/comparable counts, equal-member averages rounded once, and member coverage. Members without comparisons do not enter the average; no comparisons yields `percent: null` and an empty state, whereas real disagreement can yield 0%.

Both feed responses and `/users/me/alignment` use the user's saved current delegation and the same optional policy area. Feed and BillPage answers now save validated `member_vote_id` links. Existing unlinked answers remain excluded until explicitly answered again. Creating, changing, and removing an answer refreshes card alignment without reloading feed votes. Returning from BillPage also refreshes cached alignment. Refreshes use the latest policy scope and discard superseded responses.

RepCard displays comparable counts, coverage, and the empty state. Its current House presentation is retained; chamber tabs and Senator presentation are step 3, not part of this implementation. The current House-only answer UI does not manufacture Senator scores.

The additive migration `20261009154322_link_alignment_stances_to_member_votes.sql` was applied to `votefeed-dev` (`kddqnmenstoilnzwajnb`) on October 9, 2026. The nullable integer column, validated foreign key with `ON DELETE SET NULL`, partial user/event index, and migration-history entry were verified remotely. The filename matches the version assigned by Supabase. Production was not changed. No historical backfill is performed.

Verification: the four `tests/*alignment*.test.mjs` files cover classification, event deduplication, 93% with 82/102 counts, rounding, missing data, policy scopes, and client event selection. With `ALIGNMENT_TEST_POSTGRES=1`, the PostgreSQL test additionally exercises the migration, real SQL, and authenticated Express create/change/delete routes against localhost port 55439 in a rolled-back test schema. Browser checks use isolated mocked authentication/API fixtures, not a production user.

## Accepted scoring definition

Each selected member with comparable user responses has an individual score:

`member alignment = agreement count / comparable response count`

The tab score is the simple average of those individual fractions, multiplied by 100 and rounded once. Each member has equal weight regardless of response count. House uses the House member's score; Senate averages the Senators with data; All Reps averages all selected members with data.

| Member | Agreements / comparable responses | Individual alignment |
| --- | --- | --- |
| House member | 80/100 | 80% |
| Senator A | 1/1 | 100% |
| Senator B | 1/1 | 100% |

The unrounded average is `(0.8 + 1 + 1) / 3 * 100 = 93.333...%`; the gauge shows 93%. The combined evidence is 82 agreements out of 102 comparisons. Dividing 82 by 102 would produce a different metric, about 80%, and must not determine this gauge.

Keep agreement/comparison counts available per member and across the selected delegation. The intent is to encourage users to respond to more votes and see how much evidence supports their scores. More responses improve coverage but can raise or lower alignment; they do not guarantee a higher score or a statistically unbiased sample. The comparison denominator counts responses that can be evaluated, as the existing card counts saved responses; it is not every available congressional vote. If participation against all available votes is displayed later, it needs a separate count and a defined time scope.

An unanswered vote is not a disagreement. A selected member with no comparable responses has no score and is excluded from the average. Show coverage such as "Based on 2 of 3 representatives" when only two have data. If none have data, show "No alignment data yet". A vacancy is not a member with a 0% score.

For an equal-member average, the combined evidence fraction can differ from the displayed percentage. The eventual card copy must distinguish "Average alignment" from the combined agreement count instead of implying that the count ratio produces the gauge value.

## Current input and persistence

- In [`Feed.jsx`](../client/src/Feed.jsx), the thumbs-up button calls `handleStance(vote.bill_id, "approve")` and is labeled "Agree with Rep."; thumbs-down sends `"disapprove"` and is labeled "Disagree with Rep.". These responses describe agreement with the member, not independent support or opposition to a bill.
- `handleStance` looks up the existing interaction through `interactionsByBill[billId]`. Repeating the selected answer deletes the interaction; changing it updates the stance; a new answer posts `bill_id`, `rep_bioguide_id`, and `stance`. The client does not submit a recorded-vote ID or roll-call identity.
- [`BillPage.jsx`](../client/src/BillPage.jsx) uses the same agree/disagree meaning in `handleStanceClick` and also saves the bill and member IDs without a roll-call identity. This second input path must remain consistent with the feed when the answer model is implemented.
- [`api/interactions.js`](../server/src/api/interactions.js) derives the user ID from `requireUser` on creation and passes the remaining fields to `addStance`. Updates and deletions check interaction ownership.
- [`queries/interactions.js`](../server/src/db/queries/interactions.js) writes those fields to `interactions`. [`schema.sql`](../server/src/db/schema.sql) defines `stance`, `user_id`, `bill_id`, and `rep_bioguide_id`, but no vote-event reference, saved member position, or timestamp identifying the action answered. It also declares no uniqueness constraint for a user/bill/member response and no constraint limiting the stance values.

Thus an `approve` row can be read as a direct reported agreement with the saved member, but it does not establish which recorded action was approved. In particular, agreement with a member voting Nay must not be interpreted as support for the bill or copied as agreement with a Senator voting Yea.

## Current recorded-vote relationship

[`schema.sql`](../server/src/db/schema.sql) stores recorded positions in `member_voting_record.vote`, with `member_id`, legislation type/number, chamber, Congress, session, and roll-call number. A unique index identifies a member's voting event by `(member_id, chamber, congress_number, session_number, roll_call_number)`.

In [`queries/houseVotes.js`](../server/src/db/queries/houseVotes.js), `findMemberVotes` selects the latest dated vote per legislation type/number for the requested member, optionally filtered by chamber. Ties are ordered by session, roll-call number, and record ID. It joins a bill using `bills.number = legislationNumber` and `bills.bill_type = legislation_type`, then returns `bills.id` as `bill_id`. It joins roll-call summaries using the chamber, Congress, session, roll-call number, and legislation identity.

That explains the existing path from a feed vote to a saved bill ID. It does not bind the saved response to that vote: when a newer roll call becomes the displayed vote for the same bill, the bill-keyed response still exists. Nor does matching bill type/number establish that two chambers voted on the same question or version. The feed's bill grouping and bill join also omit Congress from the bill identity, even though recorded vote identities include it; future comparison logic must account for the intended Congress scope.

## Current summary and display

`getAlignmentByUserAndRep` in [`queries/interactions.js`](../server/src/db/queries/interactions.js) joins `interactions` to `bills`, filters by user/member and optional `bills.policy_area`, then counts all matching interaction rows and the `approve`/`disapprove` rows. It does not join `member_voting_record`. Duplicate interaction rows would each count, and an unsupported stance value would count toward the total without counting as approve or disapprove.

`toAlignmentSummary` calculates `round(approveCount / totalCount * 100)`. With no rows it currently returns `percent: 0`, `hasData: false`, and `emptyMessage: null`.

[`api/users.js`](../server/src/api/users.js) calls this query for one `repBioguideId` through `/me/alignment`. `/me/feed` resolves the saved district's House member and includes the same summary in the feed response. `refreshAlignmentSummary` in `Feed.jsx` requests the single-member summary after adding, changing, or deleting a stance, preserving the selected policy area.

[`RepCard.jsx`](../client/src/RepCard.jsx) displays `alignment.percent` and "You agree on {approveCount} out of {totalCount} votes" whenever an alignment object exists. It currently does not use `hasData` to show the planned empty state. [`Profile.jsx`](../client/src/Profile.jsx) also passes the feed's alignment to `RepCard`.

## Comparable pair contract

Step 2, item 2 is implemented as the pure `compareStanceWithMemberVote` helper in [`voteAlignment.js`](../server/src/utils/voteAlignment.js), verified by [`vote-alignment.test.mjs`](../tests/vote-alignment.test.mjs). It classifies one already-linked pair; it does not retrieve, deduplicate, or aggregate votes.

Input stance: `{ bill_id, stance }` for an explicit independent `support` or `oppose` answer. Input member vote: `{ id, bill_id, member_id, vote }`. The caller must supply `bill_id` from a verified measure join scoped to the intended Congress and comparison question/version. Matching bill IDs is necessary but cannot by itself establish eligibility for procedural votes or different measure versions. That eligibility must be resolved by the query before invoking this helper.

`Yea` and `Aye` map to support; `Nay` and `No` map to opposition, ignoring case and surrounding whitespace. Other positions, including Present and Not Voting, are excluded. A missing stance, unknown stance value, missing bill link, or different bill returns `null`, meaning no comparable pair. A comparable result is `{ userPosition, memberPosition, agrees }`; `agrees: false` is a genuine disagreement, unlike `null`.

For the current `approve`/`disapprove` semantics, the stance must additionally provide `member_vote_id` and `rep_bioguide_id`, matching the recorded event's `id` and `member_id`. Approve adopts that action's normalized position; disapprove adopts its opposite. For example, approve of Nay means opposition and agreement with that member. This direct agreement is not transferable to another member or event.

`member_vote_id` is the helper's required input contract for direct answers, not an existing database column. Current saved rows have no such link and are excluded by this helper. No historical rows have been backfilled or reinterpreted. Independent support/opposition values likewise define the comparison input contract; the existing buttons continue to save approve/disapprove. A future storage/input change must establish the reference or independent answer explicitly before the query can use it.

Run `node --test tests/vote-alignment.test.mjs` from the repository root. Expected: all tests pass, covering both position directions, direct agreement with Nay, missing and non-comparable data, and rejection of different bills, members, or events. Runtime API summaries still use the existing interaction-count query until subsequent items integrate the comparison logic.

## Repeated roll call rule

Step 2, item 3 uses one comparison per explicitly answered member voting event. Multiple answered roll calls on one bill count separately; a newer event does not replace the older event's answer. This matches the intent to let users build their score by weighing in on more votes. A single answer must not be expanded across every roll call on that bill.

[`queries/alignment.js`](../server/src/db/queries/alignment.js) implements `getComparableAlignmentVotes(userId, memberIds, { policyArea })`. It selects exact event links for the requested user and members, validates the member and bill relationship, and applies the optional policy-area filter. It does not infer a Senator's answer from a House interaction. Each response is scoped to the linked event, including its voting question; independent support/opposition inputs supplied to this query must likewise mean a position on that exact question.

`selectComparableAlignmentVotes` deduplicates by user, member, chamber, Congress, session, and roll-call number. Different members remain separate even when they vote on the same measure or event. Duplicate copies count once. If conflicting saved interactions exist for one event, the greatest interaction ID wins deterministically. This is a duplicate-row tie-breaker, not an edit timestamp: editing an older duplicate does not make it the winning row. A latest invalid answer is excluded rather than falling back to an older answer. Missing event identities and non-comparable positions are excluded.

The query returns individual comparisons with their event and member identities and `agrees`; aggregation into member counts and tab percentages belongs to the next item. The existing `getAlignmentByUserAndRep` and routes are unchanged until that integration, preserving current runtime behavior.

[`20261009190000_link_alignment_stances_to_member_votes.sql`](../supabase/migrations/20261009190000_link_alignment_stances_to_member_votes.sql) adds nullable `interactions.member_vote_id` with a foreign key to the recorded event and a user/event lookup index. The fresh schema includes the same addition. No legacy backfill is attempted; deleting a recorded vote clears the link instead of deleting a user's response. The migration has not been applied to a database. Until it is applied, the new query must not be used against the older schema. The current input paths still do not save links and will need that integration before their answers can enter the new query.

Verification: run `& 'C:\Program Files\nodejs\node.exe' --test tests/vote-alignment.test.mjs tests/alignment-roll-calls.test.mjs`. Tests cover separate roll calls on one measure, repeated copies, conflicting answers, member/chamber/Congress/session boundaries, excluded inputs, and query parameters. Query parameter tests use a supplied runner; they do not execute SQL against PostgreSQL or validate the migration against deployed data.

## Boundaries for the remaining items

The average, count presentation, pair-classification contract, and repeated-event query are implemented or documented above. Applying the nullable-link migration, saving explicit event links from the input paths, aggregating the returned comparisons, refreshing tab-scoped summaries, and rendering them remain subsequent work.

Those items must preserve the actual agree/disagree meaning of existing responses. They must either retain an unambiguous reference to the answered member action or explicitly introduce an independent user position with a defined comparison question. Existing ambiguous responses cannot be silently reinterpreted as bill support. The current House-only response path does not supply independent Senator agreement scores merely because Senator records are available.

## Verification of this trace

From the repository root in PowerShell:

```powershell
git diff --check
Get-Content specs/rep-card-alignment-trace.md
rg -n 'handleStance|Agree with|Disagree with|interactionsByBill' client/src/Feed.jsx client/src/BillPage.jsx
rg -n 'getAlignmentByUserAndRep|approve_count|total_count|toAlignmentSummary' server/src/db/queries/interactions.js
rg -n 'latest_vote_per_bill|JOIN bills|congress_number' server/src/db/queries/houseVotes.js
```

Expected: the documented input meaning and bill-keyed storage match those source paths; the current alignment query counts interaction rows, while the feed vote query separately selects recorded member votes. The checklist marks only the first item in step 2 complete. This source inspection does not verify deployed data quality or change runtime behavior.
