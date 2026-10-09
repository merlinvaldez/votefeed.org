import assert from "node:assert/strict";
import test from "node:test";
import { selectComparableAlignmentVotes, getComparableAlignmentVotes } from "../server/src/db/queries/alignment.js";

function pair(interactionId, rollCall, memberId = "H001", answer = "approve") {
  const memberVote = {
    id: rollCall, bill_id: 7, member_id: memberId, vote: "Yea",
    chamber: "House", congress_number: 119, session_number: 1,
    roll_call_number: rollCall,
  };
  return {
    stance: { id: interactionId, user_id: 1, bill_id: 7, stance: answer,
      rep_bioguide_id: memberId, member_vote_id: rollCall },
    memberVote,
  };
}

test("separately answered roll calls on one bill count separately", () => {
  assert.equal(selectComparableAlignmentVotes([pair(1, 10), pair(2, 11)]).length, 2);
});

test("duplicate copies and answers count once, greatest interaction ID wins", () => {
  const old = pair(1, 10);
  const newer = pair(2, 10, "H001", "disapprove");
  for (const rows of [[old, newer, newer], [newer, old, newer]]) {
    const result = selectComparableAlignmentVotes(rows);
    assert.equal(result.length, 1);
    assert.equal(result[0].interactionId, 2);
    assert.equal(result[0].agrees, false);
  }
});

test("members, chambers, Congresses and sessions have separate event identities", () => {
  const original = pair(1, 10);
  const otherMember = pair(2, 10, "H002");
  const otherChamber = pair(3, 10);
  otherChamber.memberVote.chamber = "Senate";
  const otherCongress = pair(4, 10);
  otherCongress.memberVote.congress_number = 120;
  const otherSession = pair(5, 10);
  otherSession.memberVote.session_number = 2;
  assert.equal(selectComparableAlignmentVotes([
    original, otherMember, otherChamber, otherCongress, otherSession,
  ]).length, 5);
});

test("non-comparable latest answers and incomplete event identities are excluded", () => {
  const invalid = pair(2, 10, "H001", "unknown");
  assert.deepEqual(selectComparableAlignmentVotes([pair(1, 10), invalid]), []);
  for (const field of ["congress_number", "session_number", "roll_call_number"]) {
    const row = pair(1, 10);
    row.memberVote[field] = null;
    assert.deepEqual(selectComparableAlignmentVotes([row]), []);
  }
  const missingLink = pair(1, 10);
  missingLink.stance.member_vote_id = null;
  assert.deepEqual(selectComparableAlignmentVotes([missingLink]), []);
  const absent = pair(1, 10);
  absent.memberVote.vote = "Not Voting";
  assert.deepEqual(selectComparableAlignmentVotes([absent]), []);
});

test("query passes user, unique selected members and policy scope to its runner", async () => {
  const runner = { async query(sql, params) {
    assert.deepEqual(params, [1, ["H001", "H002"], "Health"]);
    return { rows: [pair(1, 10), pair(1, 10)] };
  } };
  const result = await getComparableAlignmentVotes(1, ["H001", "H002", "H001"], {
    policyArea: "Health", runner,
  });
  assert.equal(result.length, 1);
  assert.deepEqual(await getComparableAlignmentVotes(1, [], { runner }), []);
});
