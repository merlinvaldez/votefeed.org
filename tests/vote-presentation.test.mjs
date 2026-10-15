import test from "node:test";
import assert from "node:assert/strict";
import { partyPortraitColor } from "../client/src/memberPortrait.js";
import { voteResultPresentation } from "../client/src/voteResult.js";

test("party portrait colors support full names, party suffixes and abbreviations", () => {
  for (const party of ["D", "Democrat", "Democratic Party", " democrat "]) assert.equal(partyPortraitColor(party), "#2563eb");
  for (const party of ["R", "Republican", "Republican Party"]) assert.equal(partyPortraitColor(party), "#dc2626");
  for (const party of ["I", "Independent", null, "Unknown"]) assert.equal(partyPortraitColor(party), "#6b7280");
});

test("Senate and House outcomes share identical labels, styles and icon outcomes", () => {
  assert.deepEqual(voteResultPresentation("Bill Passed"), voteResultPresentation("Passed"));
  assert.deepEqual(voteResultPresentation("Bill Failed"), voteResultPresentation("Failed"));
  assert.equal(voteResultPresentation("Bill Passed").className, "success");
  assert.equal(voteResultPresentation("Bill Failed").className, "danger");
  assert.deepEqual(voteResultPresentation("Other result"), { label: "Other result", className: "neutral", outcome: null });
  assert.equal(voteResultPresentation(null).label, "Unavailable");
});
