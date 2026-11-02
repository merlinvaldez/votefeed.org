import test from "node:test";
import assert from "node:assert/strict";
import { normalizeState, normalizeDistrict, normalizeRace, raceKey, isReleaseRace, sourceIdentityKey, positionVersionKey, validateExtractionItem, RELEASE_SCOPE, matchesPolicyArea, ELECTION_GEOGRAPHY_SOURCE, ELECTION_GEOGRAPHY_VERSION, isCurrentElectionGeographyEvidence, isVerifiedCurrentElectionGeography } from "../server/src/elections/contracts.js";

const house = { office: "house", state: "ny", district: "01", electionDate: "2026-11-03", stage: "general", contestType: "regular" };
test("release scope is explicit and excludes other cycles, stages and special races", () => {
  assert.equal(RELEASE_SCOPE.states.length, 50);
  assert.ok(isReleaseRace(house));
  for (const change of [{ stage: "primary" }, { stage: "runoff" }, { contestType: "special" }, { electionDate: "2028-11-07" }]) assert.equal(isReleaseRace({ ...house, ...change }), false);
});
test("canonical geography rejects unsupported and malformed identities", () => {
  assert.equal(normalizeState(" ny "), "NY");
  for (const value of ["00", "AL", "at-large", 0]) assert.equal(normalizeDistrict(value), 0);
  assert.equal(normalizeRace(house).district, 1);
  for (const value of [null, "", true, -1, "1.0"]) assert.throws(() => normalizeDistrict(value));
  assert.throws(() => normalizeState("DC"));
  assert.throws(() => normalizeRace({ ...house, electionDate: "2026-02-30" }));
  assert.throws(() => normalizeRace({ ...house, senateSeat: 1 }));
});
test("race identity preserves Senate seats, dates, stages and special contests", () => {
  const senate = { ...house, office: "senate", district: null, senateSeat: 2 };
  const keys = [senate, { ...senate, senateSeat: 3 }, { ...senate, contestType: "special" }, { ...senate, stage: "runoff" }, { ...senate, electionDate: "2026-12-01" }, house].map(raceKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.throws(() => normalizeRace({ ...senate, senateSeat: "senior" }));
});
test("uncategorized Elections filtering matches only null topics", () => {
  assert.equal(matchesPolicyArea(null, "uncategorized"), true);
  assert.equal(matchesPolicyArea(undefined, "uncategorized"), true);
  assert.equal(matchesPolicyArea("housing", "uncategorized"), false);
  assert.equal(matchesPolicyArea("housing", "housing"), true);
  assert.equal(matchesPolicyArea(null, "housing"), false);
  assert.equal(matchesPolicyArea(null, null), true);
});
test("saved election geography must match the current map and account state", () => {
  const evidence = {
    state: "NY",
    district: 13,
    cycle: 2026,
    boundaryVersion: ELECTION_GEOGRAPHY_VERSION,
    sourceUrl: ELECTION_GEOGRAPHY_SOURCE,
    status: "verified",
  };
  assert.equal(isCurrentElectionGeographyEvidence(evidence, "New York"), true);
  assert.equal(isVerifiedCurrentElectionGeography(evidence, "New York"), true);
  assert.equal(isCurrentElectionGeographyEvidence(evidence, null), true);
  assert.equal(isVerifiedCurrentElectionGeography(evidence, null), true);
  assert.equal(isCurrentElectionGeographyEvidence(evidence, ""), true);
  assert.equal(isCurrentElectionGeographyEvidence({ ...evidence, state: "PA" }, "New York"), false);
  assert.equal(isCurrentElectionGeographyEvidence(evidence, "Pennsylvania"), false);
  assert.equal(isCurrentElectionGeographyEvidence({ ...evidence, cycle: 2024 }, "New York"), false);
  assert.equal(isCurrentElectionGeographyEvidence({ ...evidence, boundaryVersion: "legacy" }, "New York"), false);
  assert.equal(isVerifiedCurrentElectionGeography({ ...evidence, status: "unresolved" }, "New York"), false);
  assert.equal(isVerifiedCurrentElectionGeography({ ...evidence, district: null }, "New York"), false);
});
test("source IDs and accepted claim versions are collision safe and repeatable", () => {
  assert.notEqual(sourceIdentityKey({ system: "fec:candidate", id: "1" }), sourceIdentityKey({ system: "state:NY:candidate", id: "1" }));
  const claim = { candidacyId: "c1", claimId: "p1", claimText: "Build more homes" };
  assert.equal(positionVersionKey(claim), positionVersionKey({ ...claim }));
  for (const change of [{ candidacyId: "c2" }, { claimId: "p2" }, { claimText: "Build fewer homes" }]) assert.notEqual(positionVersionKey(claim), positionVersionKey({ ...claim, ...change }));
});
test("extraction requires exact evidence and cannot self-authorize publication", () => {
  const snapshot = { id: "s1", candidacyId: "c1", text: "Our plan: Build more homes." };
  const item = { snapshotId: "s1", candidacyId: "c1", topic: "housing", claimText: "Build more homes", summary: "Supports building more homes.", excerpt: "Build more homes." };
  assert.equal(validateExtractionItem(item, snapshot).outcome, "requires-semantic-validation");
  for (const change of [{ snapshotId: "s2" }, { candidacyId: "c2" }, { topic: "invented" }, { summary: " " }, { excerpt: "Build fewer homes." }]) assert.equal(validateExtractionItem({ ...item, ...change }, snapshot).outcome, "invalid");
});
