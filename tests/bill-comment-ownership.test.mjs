import test from "node:test";
import assert from "node:assert/strict";
import pg from "../server/node_modules/pg/lib/index.js";
import { listOwnedBillComments } from "../server/src/db/queries/comments.js";

test("discussion excludes owned public copies while preserving other constituents", async () => {
  const { otherPublicComments } = await import("../client/src/publicComments.js");
  assert.deepEqual(otherPublicComments([
    { id: "mine", is_owned_by_viewer: true },
    { id: "other", is_owned_by_viewer: false },
  ]), [{ id: "other", is_owned_by_viewer: false }]);
});

test("PostgreSQL: returning users recover all their bill comments across vote events", {
  skip: process.env.ALIGNMENT_TEST_POSTGRES !== "1",
}, async () => {
  const client = new pg.Client({ host: "127.0.0.1", port: 55439, user: "postgres", database: "postgres" });
  await client.connect();
  const schema = `comment_ownership_${process.pid}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema};
      CREATE TABLE reps(bioguideid text, full_name text, chamber text);
      INSERT INTO reps VALUES ('H','House Member','House'),('S','Alice Smith','Senate');
      CREATE TABLE interactions(id integer PRIMARY KEY, user_id integer, bill_id integer,
        rep_bioguide_id text, member_vote_id integer, stance text);
      CREATE TABLE bill_comments(id integer, interaction_id integer, draft_text text,
        approved_text text, moderation_status text, moderation_reason text, is_public boolean,
        updated_at timestamptz, created_at timestamptz DEFAULT now());
      INSERT INTO interactions VALUES (1,5,7,'H',10,'approve'),(2,5,7,'S',20,'disapprove'),
        (3,6,7,'H',10,'approve'),(4,5,8,'H',30,'approve');
      INSERT INTO bill_comments(id,interaction_id,draft_text,approved_text,moderation_status,is_public)
        VALUES (11,1,'private','private','approved',false),(12,2,'public','public','approved',true),
        (13,3,'someone else','someone else','approved',true),(14,4,'another bill',null,'draft',false);`);
    const rows = await listOwnedBillComments(5, 7, client);
    assert.deepEqual(rows.map(row => row.id), [2, 1]);
    assert.deepEqual(rows.map(row => row.comment_approved_text), ["public", "private"]);
    assert.deepEqual(rows.map(row => row.member_vote_id), [20, 10]);
    assert.deepEqual(rows.map(row => row.recipient_name), ['Alice Smith', 'House Member']);
    assert.deepEqual(await listOwnedBillComments(99, 7, client), []);
  } finally {
    await client.query(`DROP SCHEMA ${schema} CASCADE`);
    await client.end();
  }
});

test("owned bill comments load independently of representative and vote", async () => {
  const { listOwnedBillComments } = await import("../server/src/db/queries/comments.js");
  const calls = [];
  const runner = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: 12, comment_id: "saved" }] };
  } };
  assert.deepEqual(await listOwnedBillComments(5, 7, runner), [{ id: 12, comment_id: "saved" }]);
  assert.deepEqual(calls[0].params, [5, 7]);
  assert.match(calls[0].sql, /interactions.user_id\s*=\s*\$1/);
  assert.match(calls[0].sql, /interactions.bill_id\s*=\s*\$2/);
  assert.doesNotMatch(calls[0].sql, /LIMIT 1/);
});
