import assert from "node:assert/strict";
import test from "node:test";
import { billFolderTabs, initialBillFolder, billNavigation, billDetailUrl, panelBill } from "../client/src/billDetailContext.js";

const member = (id, name, chamber = "Senate") => ({ bioguideId: id, name, chamber, memberVoteId: id.charCodeAt(0) });
const card = (id, members, position = "Yea", chamber = "Senate") => ({ id, members, position,
  event: { chamber, congress: 119, session: 2, rollCall: 7 },
  bill: { id: 3, congress: 119, type: "hr", number: 9 }, votedOn: "2026-10-01T12:00:00Z", result: null });
const a = member("A", "Smith, Alice");
const b = member("B", "Robert Jones");
const h = member("H", "House Member", "House");
const detail = cards => ({ cards, delegation: { houseMember: { bioguideid: "H" }, senators: [{ bioguideid: "A" }, { bioguideid: "B" }] },
  bill: { id: 3, bill_type: "hr", number: 9, legislation_url: "https://www.congress.gov/bill/119th-congress/house-bill/9" } });

test("matching Senate action stays combined; All Reps includes each exact chamber action", () => {
  const tabs = billFolderTabs(detail([card("house", [h], "Nay", "House"), card("senate", [a, b])]));
  assert.deepEqual(tabs.map(tab => tab.label), ["All Reps", "House", "Senate"]);
  assert.equal(tabs[0].cards.length, 2);
  assert.equal(tabs[2].cards[0].members.length, 2);
  assert.equal(initialBillFolder(tabs, { chamber: "Senate", cardId: "senate" }), "Senate");
  assert.equal(initialBillFolder(tabs, { chamber: "House", cardId: "house" }), "House");
  assert.equal(initialBillFolder(tabs, { chamber: "All Reps", cardId: "senate" }), "All Reps");
});

test("split positions use separate surname tabs and select the clicked Senator", () => {
  const tabs = billFolderTabs(detail([card("one", [a]), card("two", [b], "Not Voting")]));
  assert.deepEqual(tabs.map(tab => tab.label), ["All Reps", "House", "Smith", "Jones"]);
  assert.equal(initialBillFolder(tabs, { chamber: "Senate", cardId: "two" }), "B");
  assert.deepEqual(tabs[3].cards[0].members.map(member => member.memberVoteId), [b.memberVoteId]);
  assert.equal(tabs[3].cards[0].position, "Not Voting");
  const duplicates = billFolderTabs(detail([card("one", [a]), card("two", [{ ...b, name: "Robert Smith" }])]));
  assert.deepEqual(duplicates.slice(2).map(tab => tab.label), ["Smith, Alice", "Robert Smith"]);
});

test("vacant chambers and chambers with no vote do not manufacture actions", () => {
  const missingHouse = detail([card("one", [a])]);
  missingHouse.delegation.houseMember = null;
  assert.deepEqual(billFolderTabs(missingHouse).map(tab => tab.label), ["All Reps", "Senate"]);
  const empty = detail([]);
  empty.delegation.senators = [];
  const tabs = billFolderTabs(empty);
  assert.deepEqual(tabs.map(tab => tab.label), ["All Reps", "House"]);
  assert.deepEqual(tabs[1].cards, []);
});

test("detail URLs survive refresh with exact Congress, source card and district zero", () => {
  const source = card("opaque-card", [a, b]);
  const navigation = new URL(billNavigation(source, "Senate", { state: "Alaska", district: 0 }), "https://example.test");
  assert.equal(navigation.searchParams.get("congress"), "119");
  assert.equal(navigation.searchParams.get("district"), "0");
  assert.equal(navigation.searchParams.get("cardId"), source.id);
  for (const authenticated of [true, false]) {
    const url = new URL(billDetailUrl({ apiBase: "https://example.test", authenticated,
      billType: "hr", billNumber: 9, congress: 119, cardId: source.id, location: { state: "Alaska", district: 0 } }));
    assert.equal(url.searchParams.has("state"), !authenticated);
    assert.equal(url.searchParams.get("congress"), "119");
  }
  const view = panelBill(detail([source]), source, b);
  assert.equal(view.member_vote_id, b.memberVoteId);
  assert.equal(view.vote_result, null);
  assert.equal(view.congress_number, 119);
  assert.equal(panelBill(detail([]), null, null).member_vote_id, null);
});
