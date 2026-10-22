import assert from "node:assert/strict";
import test from "node:test";
import express from "../server/node_modules/express/index.js";
import { readBillDelegation } from "../server/src/db/queries/billDelegation.js";
import { billDelegationHandler } from "../server/src/api/billDelegation.js";

function fixture({ split = false, vacantHouse = false, results = true } = {}) {
  const bill = { id: 7, number: 7, bill_type: "hr", title: "Example measure", summary: "<p>Official</p>",
    legislation_url: "https://www.congress.gov/bill/119th-congress/house-bill/7" };
  const roster = [{ bioguideid: "H", chamber: "House of Representatives", full_name: "House Member", state: "Alaska" },
    { bioguideid: "A", chamber: "Senate", full_name: "Alice Smith", state: "Alaska" },
    { bioguideid: "B", chamber: "Senate", full_name: "Bob Jones", state: "Alaska" }].filter(row => !vacantHouse || row.bioguideid !== "H");
  const votes = roster.map((row, i) => ({ member_id: row.bioguideid, member_vote_id: i + 1, bill_id: 7,
    chamber: row.chamber === "Senate" ? "Senate" : "House", congress_number: 119, session_number: 2,
    roll_call_number: 5, legislation_type: "hr", legislationnumber: 7,
    voted_on: "2026-10-01T12:00:00Z", voted_on_precise: "2026-10-01T12:00:00.000000Z",
    vote: split && row.bioguideid === "B" ? "Nay" : "Yea", legislation_url: bill.legislation_url }));
  const calls = [];
  const runner = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT * FROM bills")) return { rows: [bill] };
    if (sql.includes("SELECT * FROM reps")) return { rows: roster };
    if (sql.includes("WITH eligible_votes")) return { rows: votes };
    if (sql.includes("FROM roll_call_summaries")) return { rows: results ? [
      { chamber: "House", session_number: 2, roll_call_number: 5, result: "Passed", yes_count: 220, no_count: 200 },
      { chamber: "Senate", session_number: 2, roll_call_number: 5, result: "Failed", yes_count: 40, no_count: 60 },
      { chamber: "Senate", session_number: 1, roll_call_number: 5, result: "Wrong event", yes_count: 99, no_count: 1 },
    ] : [] };
    assert.fail(sql);
  } };
  return { runner, calls };
}
const options = { congress: 119, billType: "hr", billNumber: 7 };

test("bill detail retains exact members and chamber-specific results, including a House vacancy", async () => {
  for (const vacantHouse of [false, true]) for (const split of [false, true]) {
    const { runner, calls } = fixture({ vacantHouse, split });
    const detail = await readBillDelegation({ state: "Alaska", district: 0 }, { ...options, runner });
    const senate = detail.cards.filter(card => card.event.chamber === "Senate");
    assert.equal(senate.length, split ? 2 : 1);
    assert.equal(senate.flatMap(card => card.members).length, 2);
    assert.ok(senate.every(card => card.result.result === "Failed"));
    assert.equal(detail.delegation.houseMember === null, vacantHouse);
    assert.deepEqual(calls.at(-1).params, [119, "hr", 7]);
    const exact = await readBillDelegation({ state: "Alaska", district: 0 }, { ...options, runner, cardId: senate[0].id });
    assert.deepEqual(exact, detail);
  }
});

test("wrong Congress, stale action context, and missing totals never substitute another event", async () => {
  const { runner } = fixture({ results: false });
  await assert.rejects(readBillDelegation({}, { ...options, congress: 118, runner }), { status: 404 });
  await assert.rejects(readBillDelegation({ state: "Alaska", district: 0 }, { ...options, cardId: "changed", runner }), { status: 409 });
  const detail = await readBillDelegation({ state: "Alaska", district: 0 }, { ...options, runner });
  assert.ok(detail.cards.every(card => card.result === null));
});

test("detail HTTP validation and saved location authority", async () => {
  const calls = [];
  const app = express();
  app.use((req, _res, next) => { req.user = { id: 7, state: "Alaska", district: 0 }; next(); });
  const readDetail = async (location, identity) => { calls.push({ location, identity }); return { cards: [] }; };
  app.get("/guest/:billType/:billNumber", billDelegationHandler({ readDetail }));
  app.get("/saved/:billType/:billNumber", billDelegationHandler({ authenticated: true, readDetail }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const query of ["", "congress=0", "congress=119&congress=118", "congress=119&cardId=x&cardId=y"]) {
      assert.equal((await fetch(`${base}/guest/hr/7?${query}`)).status, 400);
    }
    assert.equal(calls.length, 0);
    assert.equal((await fetch(`${base}/saved/hr/7?congress=119&state=Ohio&district=4`)).status, 200);
    assert.deepEqual(calls[0].location, { id: 7, state: "Alaska", district: 0 });
    assert.equal((await fetch(`${base}/guest/s/7?congress=119&state=Florida&district=20`)).status, 200);
    assert.deepEqual(calls[1].location, { state: "Florida", district: "20" });
  } finally { await new Promise(resolve => server.close(resolve)); }
});
