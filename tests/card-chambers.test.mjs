import assert from "node:assert/strict";
import test from "node:test";
import { availableCardChambers, selectAvailableCardChamber } from "../client/src/cardMembers.js";

test("chamber tabs require at least one member after roster loading completes", () => {
  const roster = { houseMember: null, senators: [], houseLoading: false,
    delegationLoading: false, delegationError: null };
  assert.deepEqual(availableCardChambers(roster), []);
  assert.deepEqual(availableCardChambers({ ...roster, senators: [{}] }), ["Senate"]);
  assert.deepEqual(availableCardChambers({ ...roster, houseMember: {} }), ["House"]);
  assert.deepEqual(availableCardChambers({ ...roster, houseMember: {}, senators: [{}, {}] }),
    ["All Reps", "House", "Senate"]);
});

test("unknown and failed rosters do not masquerade as confirmed vacancies", () => {
  const pending = { houseMember: null, senators: [], houseLoading: true, delegationLoading: true };
  assert.deepEqual(availableCardChambers(pending), ["All Reps", "House", "Senate"]);
  assert.deepEqual(availableCardChambers({ ...pending, houseLoading: false,
    delegationLoading: false, delegationError: "Network error" }), ["Senate"]);
});

test("selection follows the remaining chamber and preserves valid selections", () => {
  for (const requested of ["All Reps", "House", "Senate"]) {
    assert.equal(selectAvailableCardChamber(["Senate"], requested), "Senate");
    assert.equal(selectAvailableCardChamber(["House"], requested), "House");
    assert.equal(selectAvailableCardChamber(["All Reps", "House", "Senate"], requested), requested);
  }
  // No tabs are rendered for this neutral internal feed scope.
  assert.equal(selectAvailableCardChamber([], "Senate"), "All Reps");
});
