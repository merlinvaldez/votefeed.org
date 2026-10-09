import assert from "node:assert/strict";
import test from "node:test";
import { compareStanceWithMemberVote } from "../server/src/utils/voteAlignment.js";

const vote = { id: 10, bill_id: 7, member_id: "H001", vote: "Yea" };
const stance = { bill_id: 7, stance: "support" };

test("independent support and opposition compare to Yea, Aye, Nay and No", () => {
  for (const [position, supportAgrees] of [["Yea", true], [" AYE ", true], ["Nay", false], ["No", false], [" nO ", false]]) {
    assert.equal(compareStanceWithMemberVote(stance, { ...vote, vote: position }).agrees, supportAgrees);
    assert.equal(compareStanceWithMemberVote({ ...stance, stance: "oppose" }, { ...vote, vote: position }).agrees, !supportAgrees);
  }
});

test("missing, unlinked and unsupported inputs are excluded, not disagreements", () => {
  for (const position of ["Present", "Not Voting", "Paired", "", null, undefined]) {
    assert.equal(compareStanceWithMemberVote(stance, { ...vote, vote: position }), null);
  }
  assert.equal(compareStanceWithMemberVote(null, vote), null);
  assert.equal(compareStanceWithMemberVote(stance, null), null);
  for (const bill_id of [undefined, null, "", 0, 8]) {
    assert.equal(compareStanceWithMemberVote(stance, { ...vote, bill_id }), null);
  }
  for (const value of [undefined, "", "unknown"]) {
    assert.equal(compareStanceWithMemberVote({ ...stance, stance: value }, vote), null);
  }
});

test("approve of Nay means opposition; disapprove of Nay means support", () => {
  const linked = { ...stance, stance: "approve", member_vote_id: 10, rep_bioguide_id: "H001" };
  const nay = { ...vote, vote: "Nay" };
  assert.deepEqual(compareStanceWithMemberVote(linked, nay), {
    userPosition: "oppose", memberPosition: "oppose", agrees: true,
  });
  assert.deepEqual(compareStanceWithMemberVote({ ...linked, stance: "disapprove" }, nay), {
    userPosition: "support", memberPosition: "oppose", agrees: false,
  });
  assert.equal(compareStanceWithMemberVote(linked, vote).agrees, true);
  assert.equal(compareStanceWithMemberVote({ ...linked, stance: "disapprove" }, vote).agrees, false);
});

test("legacy answers need an exact member and event link", () => {
  const linked = { ...stance, stance: "approve", member_vote_id: 10, rep_bioguide_id: "H001" };
  assert.equal(compareStanceWithMemberVote({ ...linked, member_vote_id: undefined }, vote), null);
  assert.equal(compareStanceWithMemberVote(linked, { ...vote, id: 11 }), null);
  assert.equal(compareStanceWithMemberVote(linked, { ...vote, member_id: "S001" }), null);
  assert.equal(compareStanceWithMemberVote(linked, { ...vote, bill_id: 8 }), null);
});

test("direct agreement treats No exactly like Nay", () => {
  const linked = { ...stance, member_vote_id: 10, rep_bioguide_id: "H001" };
  for (const answer of ["approve", "disapprove"]) {
    for (const position of ["No", " NO ", "no"]) {
      assert.deepEqual(
        compareStanceWithMemberVote({ ...linked, stance: answer }, { ...vote, vote: position }),
        compareStanceWithMemberVote({ ...linked, stance: answer }, { ...vote, vote: "Nay" }),
      );
    }
  }
});
