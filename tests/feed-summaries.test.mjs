import test from "node:test";
import assert from "node:assert/strict";
import { summaryIdentity, summaryView, hasSummaryText, createSummaryRequests, officialSummaryHtml } from "../client/src/feedSummaries.js";
import { matchesSummaryMeasure } from "../server/src/utils/summaryMeasure.js";
import express from "../server/node_modules/express/index.js";
import db from "../server/src/db/client.js";
import billsRouter from "../server/src/api/bills.js";

test("summary identity separates Congress and measure but shares a bill across members/events", () => {
  const card = { bill: { congress: 119, type: "s", number: 629 }, id: "one" };
  assert.equal(summaryIdentity(card), summaryIdentity({ ...card, id: "another-event" }));
  for (const bill of [{ ...card.bill, congress: 118 }, { ...card.bill, type: "hr" }, { ...card.bill, number: 630 }]) {
    assert.notEqual(summaryIdentity(card), summaryIdentity({ bill }));
  }
  const requests = createSummaryRequests();
  const key = summaryIdentity(card);
  assert.equal(requests.begin(key), true);
  assert.equal(requests.begin(key), false);
  assert.equal(requests.begin(summaryIdentity({ bill: { ...card.bill, congress: 118 } })), true);
  requests.finish(key);
  assert.equal(requests.begin(key), true);
});

test("every summary mode shows the member action exactly once with explicit unavailable states", () => {
  const ready = { officialHtml: "<p>Official</p>", simplifiedText: "Simplified", loading: false, error: null };
  assert.equal(summaryView(ready).showAction, false); // The simplified sentence includes the action.
  for (const state of [{ showOriginal: true }, { error: "failed" }, { simplifiedText: null, loading: true },
    { simplifiedText: null, loading: false }]) {
    assert.equal(summaryView({ ...ready, ...state }).showAction, true);
  }
  assert.match(summaryView({ showOriginal: true }).message, /official summary is unavailable/);
  assert.match(summaryView({ simplifiedText: null, loading: false }).message, /simplified summary is unavailable/);
  for (const invalid of [null, "", " ", "AI summary failed", "Failed to generate summary"]) assert.equal(hasSummaryText(invalid), false);
});

test("Congress verification rejects number prefixes, wrong measures and lookalike hosts", () => {
  const url = "https://www.congress.gov/bill/119th-congress/senate-bill/629";
  assert.equal(matchesSummaryMeasure({ legislation_url: url }, 119, "s", 629), true);
  for (const wrong of [url.replace("119th", "118th"), `${url}0`, url.replace("senate-bill", "house-bill"),
    url.replace("congress.gov", "congress.gov.evil"), "invalid"]) {
    assert.equal(matchesSummaryMeasure({ legislation_url: wrong }, 119, "s", 629), false);
  }
});

test("summary API verifies requested Congress before returning cached text and retains legacy URLs", async () => {
  const original = db.query;
  db.query = async () => ({ rows: [{ id: 7, aisummary: "Cached simplified text", summary: "Official",
    legislation_url: "https://www.congress.gov/bill/119th-congress/senate-bill/629" }] });
  const app = express(); app.use("/bills", billsRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/bills/s/629/ai-summary`;
  try {
    assert.equal((await fetch(`${base}?congress=118`)).status, 404);
    for (const query of ["congress=invalid", "congress=0", "congress=119&congress=118"]) {
      assert.equal((await fetch(`${base}?${query}`)).status, 400);
    }
    const response = await fetch(`${base}?congress=119`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).aiSummary, "Cached simplified text");
    assert.equal((await fetch(base)).status, 200);
  } finally { db.query = original; await new Promise(resolve => server.close(resolve)); }
});

 test("bill details extract official HTML from canonical cards and legacy responses", () => {
  assert.equal(officialSummaryHtml({ officialHtml: '<p>Official</p>', simplifiedText: 'Simple' }), '<p>Official</p>');
  assert.equal(officialSummaryHtml('<p>Legacy</p>'), '<p>Legacy</p>');
  for (const input of [null, {}, { officialHtml: {} }, { officialHtml: '' }]) assert.equal(officialSummaryHtml(input), null);
 });
