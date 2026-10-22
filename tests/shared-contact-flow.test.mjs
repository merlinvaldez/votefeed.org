import assert from "node:assert/strict";
import test from "node:test";
import { sharedContactRequest, validateSharedContactDrafts } from "../client/src/sharedContactFlow.js";
import { sharedCommentContactDrafts } from "../server/src/db/queries/sharedContactDrafts.js";

const card = { bill: { id: 7 }, members: [{ bioguideId: "A", memberVoteId: 11 }, { bioguideId: "B", memberVoteId: 12 }] };
const answers = card.members.map((member, i) => ({ id: i + 1, bill_id: 7,
  rep_bioguide_id: member.bioguideId, member_vote_id: member.memberVoteId, stance: "approve" }));
const rows = answers.map((answer, i) => ({ ...answer, chamber: "Senate", congress_number: 119,
  session_number: 2, roll_call_number: 5, vote: "Yea", event_time: "2026-10-01T12:00:00.000001Z",
  bill_type: "hr", number: 7, legislation_url: "https://www.congress.gov/bill/119th-congress/house-bill/7",
  full_name: i ? "Robert Jones" : "Alice Smith", rep_chamber: "Senate", first_name: "Fixture", state: "Alaska", district: 0,
  approved_text: "One shared comment", comment_version: "version1" }));
const request = { userId: 5, sourceInteractionId: 1, interactionIds: [1, 2] };

test("shared guides use exact answered vote links and reject partial or incomplete results", () => {
  assert.deepEqual(sharedContactRequest(card, answers), { interactionIds: [1, 2] });
  for (const bad of [answers.slice(0, 1), [{ ...answers[0], member_vote_id: 99 }, answers[1]],
    [{ ...answers[0], stance: null }, answers[1]], [{ ...answers[0], bill_id: 99 }, answers[1]]]) {
    assert.throws(() => sharedContactRequest(card, bad), /both Senators/);
  }
  const drafts = { members: [{ memberId: "A", callScript: "Call A", messageTemplate: "Dear A" },
    { memberId: "B", callScript: "Call B", messageTemplate: "Dear B" }] };
  assert.equal(validateSharedContactDrafts(card, drafts), drafts);
  assert.throws(() => validateSharedContactDrafts(card, { members: [drafts.members[0], drafts.members[0]] }), /both Senators/);
});

test("one approved comment supplies two personalized guides without writing duplicate comments", async () => {
  const inputs = [];
  const calls = [];
  const runner = { query: async (sql, params) => { calls.push({ sql, params }); return { rows }; } };
  const result = await sharedCommentContactDrafts({ ...request, generateDrafts: async input => {
    inputs.push(input); return { callScript: `Call ${input.repFullName}`, messageTemplate: `Dear ${input.repFullName}` };
  } }, runner);
  assert.deepEqual(result.members.map(member => member.memberId), ["A", "B"]);
  assert.ok(inputs.every(input => input.approvedCommentText === "One shared comment" && input.repChamber === "Senate"));
  assert.deepEqual(inputs.map(input => input.repFullName), ["Alice Smith", "Robert Jones"]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.sql.startsWith("SELECT") && JSON.stringify(call.params) === JSON.stringify([5, [1, 2], 1])));
});

test("invalid ownership, split events/positions and unapproved comments cannot generate group guides", async () => {
  for (const invalid of [rows.slice(0, 1), [rows[0], { ...rows[1], vote: "Nay" }],
    [rows[0], { ...rows[1], roll_call_number: 6 }], [rows[0], { ...rows[1], congress_number: 118 }],
    rows.map(row => ({ ...row, approved_text: null }))]) {
    await assert.rejects(sharedCommentContactDrafts({ ...request, generateDrafts: () => assert.fail("must not generate") },
      { query: async () => ({ rows: invalid }) }), error => [403, 409].includes(error.status));
  }
  await assert.rejects(sharedCommentContactDrafts({ ...request, interactionIds: [1, 1] }), { status: 400 });
});

test("a changed comment, stance or roster during generation rejects both guides", async () => {
  for (const changed of [[{ ...rows[0], comment_version: "version2" }, rows[1]],
    [rows[0], { ...rows[1], stance: "disapprove" }], rows.slice(0, 1)]) {
    let reads = 0;
    await assert.rejects(sharedCommentContactDrafts({ ...request,
      generateDrafts: async () => ({ callScript: "call", messageTemplate: "message" }) },
    { query: async () => ({ rows: ++reads === 1 ? rows : changed }) }), { status: 409 });
  }
});

test("one failed generation never returns a half-complete group", async () => {
  await assert.rejects(sharedCommentContactDrafts({ ...request, generateDrafts: async input => {
    if (input.repFullName === "Robert Jones") throw new Error("generation unavailable");
    return { callScript: "call", messageTemplate: "message" };
  } }, { query: async () => ({ rows }) }), /generation unavailable/);
});
