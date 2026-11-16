import test from "node:test";
import assert from "node:assert/strict";

test("public discussion requests carry the resolved district including district zero", async () => {
  const { publicCommentsUrl } = await import("../client/src/publicComments.js");
  const url = new URL(publicCommentsUrl("https://example.com", 7, { state: "Alaska", district: 0 }));
  assert.equal(url.pathname, "/comments/bills/7/public");
  assert.equal(url.searchParams.get("state"), "Alaska");
  assert.equal(url.searchParams.get("district"), "0");
  assert.equal(new URL(publicCommentsUrl("https://example.com", 7, { state: "New York", district: 12 })).searchParams.get("state"), "New York");
  for (const location of [null, {}, { state: "Alaska", district: null }, { state: "Alaska", district: -1 }]) {
    assert.throws(() => publicCommentsUrl("https://example.com", 7, location), /district/i);
  }
});
