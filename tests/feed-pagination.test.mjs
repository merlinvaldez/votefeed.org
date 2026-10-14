import test from "node:test";
import assert from "node:assert/strict";
import { paginateFeed } from "../server/src/utils/feedPagination.js";
import { selectDelegationVotes, groupDelegationVotes } from "../server/src/utils/delegationFeed.js";

const card = (id, date = "2026-02-01T00:00:00.000000Z") => ({ id, votedOn: date,
  members: [{ bioguideId: "S1", memberVoteId: 1 }, { bioguideId: "S2", memberVoteId: 2 }] });
function fixture(cards = [card("b"), card("a"), card("c", "2026-01-01T00:00:00.000000Z")]) {
  const snapshots = new Map();
  const options = { scope: { viewer: "user:1", state: "alaska", district: 0, members: ["S1", "S2"] },
    limit: 1, now: 1000, store: {
      save: async snapshot => snapshots.set(snapshot.id, structuredClone(snapshot)),
      get: async id => snapshots.get(id),
    }, load: async () => ({ cards, warnings: [], dataStatus: "complete" }) };
  return { options, snapshots, cards };
}

test("frozen order, complete groups, retries, exact-full last page and stable identity", async () => {
  const { options, cards } = fixture();
  const first = await paginateFeed(options);
  assert.deepEqual(first.cards.map(card => card.id), ["a"]);
  assert.equal(first.cards[0].members.length, 2);
  cards.unshift(card("new", "2026-03-01T00:00:00.000000Z"));
  const continuation = { ...options, cursor: first.page.nextCursor, load: () => assert.fail("must not reload") };
  const second = await paginateFeed(continuation);
  assert.deepEqual(second.cards.map(card => card.id), ["b"]);
  assert.deepEqual(await paginateFeed(continuation), second);
  const final = await paginateFeed({ ...continuation, cursor: second.page.nextCursor });
  assert.deepEqual(final.cards.map(card => card.id), ["c"]);
  assert.equal(final.page.hasMore, false);
  assert.equal(final.page.nextCursor, null);
  assert.equal(final.page.snapshotId, first.page.snapshotId);
  const refresh = await paginateFeed(options);
  assert.equal(refresh.cards[0].id, "new");
  assert.notEqual(refresh.page.snapshotId, first.page.snapshotId);
});

test("invalid/tampered cursors and changed options reject with 400", async () => {
  const { options } = fixture();
  const first = await paginateFeed(options);
  const cursor = first.page.nextCursor;
  for (const changes of [{ cursor: "junk" }, { cursor: cursor + "x" },
    { cursor, limit: 2 }, { cursor, policyArea: "Health" }, { limit: 0 },
    { limit: 51 }, { limit: "1.0" }, { policyArea: " " }, { offset: 0 }]) {
    await assert.rejects(paginateFeed({ ...options, ...changes }), { status: 400 });
  }
  const [body, sig] = cursor.split(".");
  const decoded = JSON.parse(Buffer.from(body, "base64url"));
  decoded.index = 2;
  await assert.rejects(paginateFeed({ ...options,
    cursor: `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${sig}` }), { status: 400 });
});

test("viewer changes reject with 403; expiry, missing snapshots, scope changes and corrections require restart", async () => {
  const { options, snapshots } = fixture();
  const first = await paginateFeed(options);
  const continuation = { ...options, cursor: first.page.nextCursor };
  await assert.rejects(paginateFeed({ ...continuation, scope: { ...options.scope, viewer: "user:2" } }), { status: 403 });
  for (const changes of [{ now: 1801000 }, { scope: { ...options.scope, district: 1 } },
    { scope: { ...options.scope, members: ["S1"] } }, { validateSnapshot: async () => false }]) {
    await assert.rejects(paginateFeed({ ...continuation, ...changes }), { status: 409, code: "FEED_RESTART_REQUIRED" });
  }
  snapshots.clear();
  await assert.rejects(paginateFeed(continuation), { status: 409 });
});

test("empty and one-page results never return misleading continuation", async () => {
  for (const cards of [[], [card("a")]]) {
    const { options } = fixture(cards);
    const result = await paginateFeed(options);
    assert.equal(result.page.hasMore, false);
    assert.equal(result.page.nextCursor, null);
  }
});

test("partial pages retain warnings; failed continuation retries preserve identities without reloading", async () => {
  const { options } = fixture();
  options.load = async () => ({ cards: [card("a"), card("b")], dataStatus: "partial",
    warnings: [{ code: "CONFLICTING_VOTE_RECORDS", message: "Some records were excluded." }],
    retry: { mode: "refresh" }, emptyReason: null });
  const first = await paginateFeed(options);
  const continuation = { ...options, cursor: first.page.nextCursor,
    load: () => assert.fail("continuation must not reload records") };
  await assert.rejects(paginateFeed({ ...continuation, validateSnapshot: async () => {
    throw new Error("temporary read failure");
  } }), /temporary read failure/);
  const retried = await paginateFeed(continuation);
  assert.deepEqual(retried.cards.map(card => card.id), ["b"]);
  assert.deepEqual(retried.warnings, first.warnings);
  assert.equal(retried.dataStatus, "partial");
  assert.deepEqual(retried.retry, { mode: "refresh" });
  assert.equal(retried.emptyReason, null);
  assert.deepEqual(await paginateFeed(continuation), retried);
});

test("microseconds determine latest selection, grouping, and page order", async () => {
  const vote = (id, micros, roll = id) => ({ member_vote_id: id, member_id: "S1", chamber: "Senate",
    congress_number: 119, session_number: 2, roll_call_number: roll, vote: "Yea",
    voted_on: new Date("2026-02-01T00:00:00Z"), voted_on_precise: `2026-02-01T00:00:00.${micros}Z`,
    bill: { id: 1, congress: 119, type: "hr", number: 1 },
    member: { bioguideId: "S1", memberVoteId: id, chamber: "Senate" } });
  const selected = selectDelegationVotes([vote(2, "000001"), vote(1, "000002")]);
  assert.equal(selected.votes[0].member_vote_id, 1);
  assert.equal(groupDelegationVotes(selected.votes).cards[0].votedOn, "2026-02-01T00:00:00.000002Z");
  const conflict = selectDelegationVotes([vote(1, "000001", 1), vote(2, "000002", 1)]);
  assert.equal(conflict.votes.length, 0);
  const { options } = fixture([card("a", "2026-02-01T00:00:00.000001Z"), card("z", "2026-02-01T00:00:00.000002Z")]);
  assert.equal((await paginateFeed(options)).cards[0].id, "z");
});
