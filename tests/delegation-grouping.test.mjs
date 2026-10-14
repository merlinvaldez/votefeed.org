import test from "node:test";
import assert from "node:assert/strict";
import { selectDelegationVotes, groupDelegationVotes, filterAndCountFeedCards } from "../server/src/utils/delegationFeed.js";

const vote = (memberId, id, changes = {}) => ({
  member_id: memberId, member_vote_id: id, chamber: "Senate", congress_number: 119,
  session_number: 2, roll_call_number: 5, voted_on: "2026-02-01T00:00:00Z", vote: "Yea",
  member: { bioguideId: memberId, memberVoteId: id, chamber: "Senate", name: memberId, portrait: null },
  bill: { id: 7, congress: 119, type: "hr", number: 7, policyArea: "Health" },
  summary: { officialHtml: null, simplifiedText: null }, ...changes,
});
const cards = rows => groupDelegationVotes(selectDelegationVotes(rows).votes).cards;

test("card counts include unknown areas, sort named areas and retain unfiltered sidebar counts", () => {
  const input = ["Health", "Education", null, "", "   ", "Health"]
    .map((policyArea, i) => ({ id: String(i), bill: { policyArea } }));
  const result = filterAndCountFeedCards(input, "Health");
  assert.equal(result.totalPolicyCount, 6);
  assert.equal(result.filteredCardCount, 2);
  assert.deepEqual(result.policyAreas, [{ name: "Education", count: 1 }, { name: "Health", count: 2 }]);
  assert.deepEqual(result.cards.map(card => card.id), ["0", "5"]);
  assert.equal(filterAndCountFeedCards(input).filteredCardCount, 6);
  assert.equal(filterAndCountFeedCards(input, "health").filteredCardCount, 0);
  assert.deepEqual(filterAndCountFeedCards([]), {
    cards: [], policyAreas: [], totalPolicyCount: 0, filteredCardCount: 0,
  });
});

test("same-event Senators combine with exact links and deterministic member order", () => {
  const result = cards([vote("S2", 2), vote("S1", 1)]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].members.map(member => member.memberVoteId), [1, 2]);
  assert.equal(result[0].id, JSON.stringify(["legislative-feed-card-v1", "Senate", 119, 2, 5, 7, "Yea", null]));
  assert.equal(cards([vote("S1", 1)])[0].id, result[0].id);
});

test("different positions, events, measures, and chambers remain separate", () => {
  for (const changes of [{ vote: "Aye" }, { vote: "Nay" }, { roll_call_number: 6 },
    { session_number: 1 }, { congress_number: 118, bill: { id: 8, congress: 118, type: "hr", number: 7 } },
    { bill: { id: 8, congress: 119, type: "s", number: 7 } },
    { chamber: "House", member: { bioguideId: "S2", memberVoteId: 2, chamber: "House" } }]) {
    assert.equal(cards([vote("S1", 1), vote("S2", 2, changes)]).length, 2);
  }
  assert.equal(cards([vote("S1", 1, { vote: "Not Voting" }), vote("S2", 2, { vote: "Not Voting" })]).length, 1);
});

test("duplicates canonicalize before latest selection and conflicts exclude the action", () => {
  const a = vote("S1", 1);
  const b = vote("S1", 2);
  const selected = selectDelegationVotes([a, a, b]);
  assert.equal(selected.votes[0].member_vote_id, 2);
  assert.equal(selected.diagnostics[0].code, "DUPLICATE_VOTE_RECORDS");
  const conflicted = selectDelegationVotes([a, vote("S1", 2, { vote: "Nay" }), vote("S2", 3)]);
  assert.deepEqual(conflicted.votes.map(row => row.member_id), ["S2"]);
  assert.equal(conflicted.diagnostics[0].code, "CONFLICTING_VOTE_RECORDS");
  const newer = vote("S1", 4, { roll_call_number: 6, voted_on: "2026-03-01T00:00:00Z" });
  assert.equal(cards([a, newer, vote("S2", 3)]).length, 2);
});

test("incomplete records and inconsistent group dates cannot create merged cards", () => {
  const selected = selectDelegationVotes([vote("S1", 1, { roll_call_number: null }), vote("S2", 2)]);
  assert.equal(selected.votes.length, 1);
  assert.equal(selected.diagnostics[0].code, "INVALID_VOTE_RECORDS");
  const result = groupDelegationVotes([vote("S1", 1), vote("S2", 2, { voted_on: "2026-02-02T00:00:00Z" })]);
  assert.equal(result.cards.length, 0);
  assert.equal(result.diagnostics[0].code, "CONFLICTING_VOTE_RECORDS");
});

test("policy filtering preserves unknown areas in the unfiltered feed", () => {
  const rows = [vote("S1", 1), vote("S2", 2), vote("S1", 3, {
    roll_call_number: 6,
    bill: { id: 8, congress: 119, type: "s", number: 8, policyArea: null },
  })];
  const selected = selectDelegationVotes(rows).votes;
  assert.equal(groupDelegationVotes(selected).cards.length, 2);
  const filtered = groupDelegationVotes(selected, { policyArea: "Health" }).cards;
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].members.length, 2);
});
