import assert from "node:assert/strict";
import test from "node:test";
import { summarizeAlignment } from "../server/src/db/queries/alignment.js";
import { findVoteInteraction, isAnsweredVote, selectCardAlignment } from "../client/src/voteInteractions.js";

const members = [
  { memberId: "H", chamber: "House", name: "House member" },
  { memberId: "S1", chamber: "Senate", name: "Senator A" },
  { memberId: "S2", chamber: "Senate", name: "Senator B" },
];
function comparisons(member, count, agreements) {
  return Array.from({ length: count }, (_, index) => ({
    memberId: member.memberId, chamber: member.chamber, agrees: index < agreements,
  }));
}

test("equal-member average gives 93% alongside 82/102 combined counts", () => {
  const result = summarizeAlignment(members, [
    ...comparisons(members[0], 100, 80),
    ...comparisons(members[1], 1, 1), ...comparisons(members[2], 1, 1),
  ]);
  assert.equal(result.percent, 93);
  assert.equal(result.agreementCount, 82);
  assert.equal(result.comparableCount, 102);
  assert.equal(result.memberCount, 3);
  assert.equal(result.membersWithData, 3);
});

test("round only the final average rather than averaging rounded member scores", () => {
  const result = summarizeAlignment(members.slice(0, 2), [
    ...comparisons(members[0], 3, 1), ...comparisons(members[1], 100, 34),
  ]);
  assert.equal(result.percent, 34);
});

test("zero comparisons means missing data; zero agreements means actual 0%", () => {
  const result = summarizeAlignment(members, comparisons(members[0], 2, 0));
  assert.equal(result.percent, 0);
  assert.equal(result.hasData, true);
  assert.equal(result.membersWithData, 1);
  assert.equal(result.members[1].percent, null);
  const empty = summarizeAlignment(members, []);
  assert.equal(empty.percent, null);
  assert.equal(empty.hasData, false);
  assert.equal(empty.emptyMessage, "No alignment data yet");
  assert.equal(summarizeAlignment([], []).memberCount, 0);
});

test("unselected members and wrong chambers cannot affect the tab", () => {
  const result = summarizeAlignment([members[0], members[0]], [
    ...comparisons(members[0], 2, 1), ...comparisons(members[1], 10, 10),
    { memberId: "H", chamber: "Senate", agrees: true },
  ]);
  assert.equal(result.percent, 50);
  assert.equal(result.comparableCount, 2);
  assert.equal(result.memberCount, 1);
});

test("exact event answers take precedence; legacy answers are not active answers", () => {
  const legacy = { id: 50, bill_id: 7, rep_bioguide_id: "H", member_vote_id: null };
  const oldVote = { ...legacy, id: 60, member_vote_id: 10 };
  const current = { ...legacy, id: 20, member_vote_id: 11 };
  const currentNewer = { ...current, id: 21 };
  assert.equal(findVoteInteraction([legacy, oldVote, current, currentNewer], 7, "H", 11), currentNewer);
  assert.equal(findVoteInteraction([oldVote], 7, "H", 11), null);
  assert.equal(findVoteInteraction([legacy], 7, "H", 11), legacy);
  assert.equal(isAnsweredVote(legacy, 11), false);
  assert.equal(isAnsweredVote(current, 11), true);
  assert.equal(isAnsweredVote(null, null), false);
  assert.equal(findVoteInteraction([current], 7, "S1", 11), null);
});

test("selecting a card summary uses the active chamber without changing other data", () => {
  const data = { selectedChamber: "House", byChamber: {
    House: { percent: 80 }, Senate: { percent: 100 }, "All Reps": { percent: 93 },
  } };
  assert.equal(selectCardAlignment(data, "Senate").percent, 100);
  assert.equal(selectCardAlignment(data, "All Reps").percent, 93);
  assert.equal(selectCardAlignment(data).percent, 80);
  assert.equal(selectCardAlignment(null), null);
});
