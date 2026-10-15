import test from "node:test";
import assert from "node:assert/strict";
import { getVotePosition } from "../client/src/votePosition.js";
import { buildCardStanceRequest } from "../client/src/voteInteractions.js";
import { normalizeMemberPosition } from "../server/src/utils/voteAlignment.js";

test("client eligibility matches server classification while retaining raw positions", () => {
  for (const raw of ["Yea", "Aye", "Nay", "No", " NO ", "yea", "Yes", "Present", "Not Voting", "Paired", "Abstain", "Unknown", "", null, undefined]) {
    const position = getVotePosition(raw);
    assert.equal(position.comparable, normalizeMemberPosition(raw) !== null);
    if (position.comparable) {
      assert.equal(position.verb, "voted");
      assert.equal(position.label, raw);
    } else {
      assert.equal(position.className, "neutral");
    }
  }
});

test("all recorded positions have truthful copy and can build a batch response", () => {
  assert.equal(getVotePosition("Not Voting").verb, "did not vote");
  assert.equal(getVotePosition("Not Voting").label, null);
  assert.equal(getVotePosition("Present").verb, "was recorded as");
  assert.equal(getVotePosition("Present").label, "Present");
  assert.equal(getVotePosition("Present", 2).verb, "were recorded as");
  assert.equal(getVotePosition(null).verb, "has no recorded position");
  const card = { bill: { id: 7 }, members: [
    { bioguideId: "S1", memberVoteId: 101, chamber: "Senate" },
    { bioguideId: "S2", memberVoteId: 102, chamber: "Senate" },
  ] };
  for (const position of ["Not Voting", "Present", "Paired", "Yes", null]) {
    assert.equal(buildCardStanceRequest({ ...card, position }, [], "approve").stance, "approve");
  }
  assert.equal(buildCardStanceRequest({ ...card, position: "Yea" }, [], "approve").stance, "approve");
});
