import test from "node:test";
import assert from "node:assert/strict";
import { findCurrentDelegation } from "../server/src/db/queries/delegation.js";

const house = { bioguideid: "H1", chamber: "House of Representatives", state: "Alaska" };
const senators = [
  { bioguideid: "S1", chamber: "Senate", state: "Alaska" },
  { bioguideid: "S2", chamber: "Senate", state: "Alaska" },
];

test("saved numeric and guest string at-large districts resolve the same delegation", async () => {
  const calls = [];
  const runner = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [house, ...senators] };
  } };
  const saved = await findCurrentDelegation({ state: "Alaska", district: 0 }, runner);
  const guest = await findCurrentDelegation({ state: "  Alaska  ", district: "0" }, runner);
  assert.deepEqual(saved, guest);
  assert.equal(saved.houseMember, house);
  assert.deepEqual(saved.senators, senators);
  assert.deepEqual(calls.map(call => call.params), [["Alaska", 0], ["Alaska", 0]]);
  assert.match(calls[0].sql, /is_current_member = true/);
  assert.match(calls[0].sql, /congressionalDistrict = \$2/);
});

test("House and Senate vacancies return valid partial or empty delegations", async () => {
  for (const rows of [[...senators], [senators[0]], [house], []]) {
    const result = await findCurrentDelegation({ state: "Alaska", district: 0 }, {
      query: async () => ({ rows }),
    });
    assert.equal(result.houseMember, rows.includes(house) ? house : null);
    assert.deepEqual(result.senators, rows.filter(row => row.chamber === "Senate"));
    assert.equal(result.district, 0);
  }
});

test("invalid or missing locations fail before reading the roster", async () => {
  const runner = { query: () => assert.fail("must not query invalid locations") };
  for (const location of [undefined, {}, { state: " " , district: 0 },
    ...[null, undefined, "", -1, "1.5", "1junk", false, [], [0], "9007199254740992"]
      .map(district => ({ state: "Alaska", district }))]) {
    await assert.rejects(findCurrentDelegation(location, runner), {
      code: "INVALID_DELEGATION_LOCATION",
    });
  }
});

test("roster errors and ambiguous House seats do not masquerade as vacancies", async () => {
  const failure = new Error("roster unavailable");
  await assert.rejects(findCurrentDelegation({ state: "Alaska", district: 0 }, {
    query: async () => { throw failure; },
  }), error => error === failure);
  await assert.rejects(findCurrentDelegation({ state: "Alaska", district: 0 }, {
    query: async () => ({ rows: [house, { ...house, bioguideid: "H2" }] }),
  }), /Multiple current House members/);
});
