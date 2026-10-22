import assert from "node:assert/strict";
import test from "node:test";
import { buildFeedUrl, adaptDelegationFeed, mergeFeedPage, createFeedRequests } from "../client/src/delegationFeedClient.js";

test("guest continuation preserves at-large location and policy without offsets", () => {
  const url = new URL(buildFeedUrl({ apiBase: "https://example.test", isGuest: true,
    district: { state: "Alaska", congressionalDistrict: 0 }, pageSize: 5,
    policyArea: "Health & Education", cursor: "signed.cursor" }));
  assert.equal(url.pathname, "/reps/delegation/feed");
  assert.equal(url.searchParams.get("district"), "0");
  assert.equal(url.searchParams.get("state"), "Alaska");
  assert.equal(url.searchParams.get("policyArea"), "Health & Education");
  assert.equal(url.searchParams.get("cursor"), "signed.cursor");
  assert.equal(url.searchParams.get("limit"), "5");
  assert.equal(url.searchParams.has("offset"), false);
});

test("signed-in feed derives location on the server for every policy page", () => {
  const url = new URL(buildFeedUrl({ apiBase: "https://example.test", isGuest: false,
    pageSize: 5, policyArea: "Health", cursor: "signed.cursor" }));
  assert.equal(url.pathname, "/users/me/delegation/feed");
  assert.equal(url.searchParams.has("state"), false);
  assert.equal(url.searchParams.has("district"), false);
  assert.equal(url.searchParams.get("cursor"), "signed.cursor");
});

test("adapter retains combined Senate vote links and terminal page with no House seat", () => {
  const card = { id: "stable-group", event: { chamber: "Senate", congress: 119, session: 1, rollCall: 4 },
    position: "Nay", votedOn: "2026-10-14T12:00:00Z",
    bill: { id: 10, congress: 119, type: "s", number: 9 },
    summary: { officialHtml: "<p>Official</p>", simplifiedText: "Simplified" },
    members: [{ bioguideId: "A", memberVoteId: 101 }, { bioguideId: "B", memberVoteId: 102 }] };
  const feed = adaptDelegationFeed({ cards: [card], delegation: { houseMember: null },
    page: { limit: 5, snapshotId: "snapshot", hasMore: false, nextCursor: null }, totalPolicyCount: 1 });
  assert.equal(feed.rep, null);
  assert.deepEqual(feed.votes[0].members, card.members);
  assert.deepEqual(feed.votes[0].summary, card.summary);
  assert.equal(feed.votes[0].officialSummary, card.summary.officialHtml);
  assert.equal(feed.votes[0].id, card.id);
  assert.equal(feed.page.hasMore, false);
  assert.equal(feed.totalPolicyCount, 1);
  assert.throws(() => adaptDelegationFeed({ cards: [], page: { hasMore: true } }), /Invalid/);
});

test("continuation comes from the server even for full final and short intermediate pages", () => {
  const card = { id: "card", event: {}, bill: {}, summary: {}, members: [] };
  const terminal = adaptDelegationFeed({ cards: Array(5).fill(card),
    page: { limit: 5, snapshotId: "snapshot", hasMore: false, nextCursor: null } });
  assert.equal(terminal.votes.length, 5);
  assert.equal(terminal.page.hasMore, false);
  const continuing = adaptDelegationFeed({ cards: [card],
    page: { limit: 5, snapshotId: "snapshot", hasMore: true, nextCursor: "opaque.cursor" } });
  assert.equal(continuing.votes.length, 1);
  assert.equal(continuing.page.hasMore, true);
  assert.equal(continuing.page.nextCursor, "opaque.cursor");
  const empty = adaptDelegationFeed({ cards: [],
    page: { limit: 5, snapshotId: "empty", hasMore: false, nextCursor: null } });
  assert.equal(empty.page.hasMore, false);
});

test("malformed continuation metadata cannot be mistaken for a completed feed", () => {
  const page = { limit: 5, snapshotId: "snapshot", hasMore: false, nextCursor: null };
  for (const invalid of [
    { hasMore: undefined }, { hasMore: "false" }, { nextCursor: "unexpected.cursor" },
    { hasMore: true, nextCursor: null }, { hasMore: true, nextCursor: 1 },
    { hasMore: true, nextCursor: " " }, { limit: 0 }, { limit: 51 },
    { snapshotId: null },
  ]) {
    assert.throws(() => adaptDelegationFeed({ cards: [], page: { ...page, ...invalid } }), /Invalid/);
  }
});

 test("scope changes ignore late successes, failures and cleanup without releasing a new request", async () => {
  const requests = createFeedRequests();
  const old = requests.begin();
  assert.equal(requests.begin(), null);
  let resolveOld;
  const response = new Promise(resolve => { resolveOld = resolve; });
  let state = 'new location/policy';
  const oldRead = response.then(value => {
    if (requests.current(old)) state = value;
  }).finally(() => requests.finish(old));
  requests.reset();
  assert.equal(old.controller.signal.aborted, true);
  const current = requests.begin();
  resolveOld('old cards');
  await oldRead;
  assert.equal(state, 'new location/policy');
  assert.equal(requests.current(current), true);
  assert.equal(requests.current(old), false);
  assert.equal(requests.begin(), null);
  requests.finish(current);
  assert.ok(requests.begin());
 });

 test("append reconciles stable IDs and refuses other snapshots, policies or consumed cursors", () => {
  const previous = { cards: [{ id: 'a', members: ['one'] }, { id: 'b' }],
    votes: [{ id: 'a', members: ['one'] }, { id: 'b' }], selectedPolicyArea: 'Health',
    scopeKey: 'guest:Alaska:0:Health', district: { state: 'Alaska', congressionalDistrict: 0 },
    page: { snapshotId: 'first', nextCursor: 'next' } };
  const next = { cards: [{ id: 'a', members: ['one', 'two'] }, { id: 'c' }],
    votes: [{ id: 'a', members: ['one', 'two'] }, { id: 'c' }], selectedPolicyArea: 'Health',
    page: { snapshotId: 'first', hasMore: false, nextCursor: null } };
  const merged = mergeFeedPage(previous, next, 'next');
  assert.deepEqual(merged.cards.map(card => card.id), ['a', 'b', 'c']);
  assert.deepEqual(merged.votes[0].members, ['one', 'two']);
  assert.equal(merged.scopeKey, previous.scopeKey);
  assert.equal(merged.district.congressionalDistrict, 0);
  assert.equal(mergeFeedPage(merged, next, 'next'), merged);
  assert.equal(mergeFeedPage(previous, { ...next, selectedPolicyArea: 'Education' }, 'next'), previous);
  assert.equal(mergeFeedPage(previous, { ...next, page: { ...next.page, snapshotId: 'other' } }, 'next'), previous);
 });

 test("an aborted request failure cannot overwrite current error or loading state", async () => {
  const requests = createFeedRequests();
  const old = requests.begin();
  let rejectOld;
  const pending = new Promise((_, reject) => { rejectOld = reject; });
  let error = '';
  let loading = true;
  const task = pending.catch(err => {
    if (requests.current(old)) error = err.message;
  }).finally(() => {
    if (requests.current(old)) loading = false;
    requests.finish(old);
  });
  requests.reset();
  const current = requests.begin();
  rejectOld(new Error('old failure'));
  await task;
  assert.equal(error, '');
  assert.equal(loading, true);
  assert.equal(requests.current(current), true);
 });

 test("chamber selection travels on initial and continuation URLs for both entry paths", () => {
  for (const isGuest of [true, false]) for (const chamber of ['All Reps', 'House', 'Senate']) {
    const url = new URL(buildFeedUrl({ apiBase: 'https://example.test', isGuest,
      district: { state: 'Alaska', district: 0 }, pageSize: 5, chamber, cursor: 'signed.cursor', policyArea: 'Health' }));
    assert.equal(url.searchParams.get('chamber'), chamber);
    assert.equal(url.searchParams.get('policyArea'), 'Health');
    assert.equal(url.searchParams.get('cursor'), 'signed.cursor');
  }
 });
