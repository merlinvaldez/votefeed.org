import assert from "node:assert/strict";
import test from "node:test";
import memberIds from "../supabase/functions/sync-senate-votes/member-ids-119.json" with { type: "json" };
import { parseSenateMenu, parseSenateVote } from "../supabase/functions/sync-senate-votes/parse.ts";

const senateUrl = (session, roll) =>
  `https://www.senate.gov/legislative/LIS/roll_call_votes/vote119${session}/vote_119_${session}_${String(roll).padStart(5, "0")}.xml`;

test("Senate menu supplies unique roll numbers for the current session", async () => {
  const response = await fetch("https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_119_2.xml");
  assert.equal(response.status, 200);
  const rolls = parseSenateMenu(await response.text(), 119, 2);
  assert.ok(rolls.length >= 249);
  assert.equal(rolls[0], 1);
  assert.ok(rolls.includes(249));
});

test("nomination has no invented bill and all member IDs resolve", async () => {
  const vote = parseSenateVote(await (await fetch(senateUrl(2, 1))).text(), 119, 2, 1);
  assert.equal(vote.bill, null);
  assert.equal(vote.positions.length, 100);
  assert.equal(vote.votedOn, "2026-01-05T22:31:00.000Z");
  assert.ok(vote.positions.every((position) => memberIds.members[position.lisId]));
});

test("amendment links to its underlying bill", async () => {
  const vote = parseSenateVote(await (await fetch(senateUrl(2, 249))).text(), 119, 2, 249);
  assert.deepEqual(vote.bill, { type: "s", number: 4668, title: null });
  assert.equal(vote.positions.length, 100);
  assert.ok(vote.positions.every((position) => memberIds.members[position.lisId]));
});

test("past session vote uses the correct Eastern winter offset", async () => {
  const vote = parseSenateVote(await (await fetch(senateUrl(1, 1))).text(), 119, 1, 1);
  assert.equal(vote.votedOn, "2025-01-09T19:54:00.000Z");
  assert.equal(vote.positions.length, 99);
  assert.ok(vote.positions.every((position) => memberIds.members[position.lisId]));
});

test("a mismatched roll identity fails before persistence", async () => {
  const xml = await (await fetch(senateUrl(2, 1))).text();
  assert.throws(() => parseSenateVote(xml, 119, 2, 2), /identity mismatch/);
});
