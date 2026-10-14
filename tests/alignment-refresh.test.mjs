import assert from "node:assert/strict";
import test from "node:test";
import { fetchDelegationAlignment } from "../client/src/alignmentRefresh.js";
import { selectCardAlignment } from "../client/src/voteInteractions.js";

test("one authenticated refresh supplies every Rep Card tab without a House member", async () => {
  const calls = [];
  const payload = { byChamber: { "All Reps": { percent: 50 }, House: { hasData: false }, Senate: { percent: 50 } } };
  const result = await fetchDelegationAlignment(async url => {
    calls.push(url);
    return { ok: true, json: async () => payload };
  }, "https://example.test", "Health & Education");
  const url = new URL(calls[0]);
  assert.equal(url.searchParams.get("chamber"), "All Reps");
  assert.equal(url.searchParams.get("policyArea"), "Health & Education");
  for (const chamber of ["All Reps", "House", "Senate"]) {
    assert.equal(selectCardAlignment(result, chamber), payload.byChamber[chamber]);
  }
  assert.equal(calls.length, 1);
});

test("failed alignment refresh rejects separately from a confirmed response save", async () => {
  let calls = 0;
  await assert.rejects(fetchDelegationAlignment(async () => {
    calls += 1;
    return { ok: false };
  }, "https://example.test"), /Failed to refresh alignment/);
  assert.equal(calls, 1);
});
