import test from "node:test";
import assert from "node:assert/strict";
import { enrichFeedPage } from "../server/src/db/queries/delegationFeedPage.js";

const page = () => ({ cards: [
  { id: "house", bill: { id: 7 }, members: [{ memberVoteId: 1 }] },
  { id: "senate", bill: { id: 7 }, members: [{ memberVoteId: 2 }, { memberVoteId: 3 }] },
  { id: "other", bill: { id: 8 }, members: [{ memberVoteId: 4 }] },
], warnings: [], dataStatus: "complete", retry: null, page: { nextCursor: "unchanged" } });

test("page enrichment queries each displayed bill once and shares its public count", async () => {
  const queries = [];
  const result = await enrichFeedPage(page(), { query: async (sql, values) => {
    queries.push(values);
    return { rows: sql.includes("FROM bills")
      ? [{ id: 7, summary: "Official", aisummary: "Simple" }]
      : [{ bill_id: 7, count: 5 }] };
  } });
  assert.deepEqual(queries, [[[7, 8]], [[7, 8]]]);
  assert.deepEqual(result.cards.map(card => card.publicCommentCount), [5, 5, 0]);
  assert.deepEqual(result.cards[0].summary, { officialHtml: "Official", simplifiedText: "Simple" });
  assert.deepEqual(result.cards[1].members, page().cards[1].members);
  assert.equal(result.page.nextCursor, "unchanged");
});

test("comment query failure retains cards and summaries, using unknown counts rather than zero", async () => {
  const log = console.error;
  console.error = () => {};
  try {
    const result = await enrichFeedPage(page(), { query: async sql => {
      if (sql.includes("FROM bills")) return { rows: [{ id: 7, summary: "Still visible" }] };
      throw new Error("unavailable");
    } });
    assert.equal(result.cards.length, 3);
    assert.ok(result.cards.every(card => card.publicCommentCount === null));
    assert.equal(result.cards[0].summary.officialHtml, "Still visible");
    assert.equal(result.dataStatus, "partial");
    assert.equal(result.warnings[0].code, "PUBLIC_COMMENT_COUNTS_UNAVAILABLE");
    assert.equal(result.retry.mode, "refresh");
  } finally { console.error = log; }
});

test("continuations replace old snapshot counts with the current public totals", async () => {
  const old = page();
  old.cards.forEach(card => { card.publicCommentCount = 99; });
  const result = await enrichFeedPage(old, { query: async sql => ({ rows:
    sql.includes("FROM bills") ? [] : [{ bill_id: 7, count: 1 }],
  }) });
  assert.deepEqual(result.cards.map(card => card.publicCommentCount), [1, 1, 0]);
});

test("empty pages do not query summaries or comments", async () => {
  const empty = { cards: [] };
  assert.equal(await enrichFeedPage(empty, { query: () => assert.fail("empty page queried") }), empty);
});
