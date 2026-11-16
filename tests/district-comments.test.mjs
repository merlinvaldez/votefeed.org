import test from "node:test";
import assert from "node:assert/strict";
import pg from "../server/node_modules/pg/lib/index.js";
import express from "../server/node_modules/express/index.js";
import db from "../server/src/db/client.js";
import router from "../server/src/api/comments.js";
import { getPublicBillCommentCounts, listPublicCommentsByBillId } from "../server/src/db/queries/comments.js";

test("PostgreSQL: counts and discussions include only approved public comments in the same state and district", {
  skip: process.env.DELEGATION_TEST_POSTGRES !== "1",
}, async () => {
  const client = new pg.Client({ host: "127.0.0.1", port: 55439, user: "postgres", database: "postgres", ssl: false });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TEMP TABLE users (id integer, first_name text, state text, district integer);
      CREATE TEMP TABLE bill_comments (id integer, bill_id integer, user_id integer, is_public boolean,
        moderation_status text, approved_text text, published_at timestamptz, updated_at timestamptz, created_at timestamptz);
      ALTER TABLE users ADD COLUMN last_name text;
      CREATE TEMP TABLE reps (bioguideid text, full_name text, chamber text);
      CREATE TEMP TABLE comment_useful_votes (comment_id integer, user_id integer);
      INSERT INTO users (id,first_name,state,district) VALUES (1,'Local','Alaska',0),(2,'Other district','Alaska',1),
        (3,'Other state','Wyoming',0),(4,'No district','Alaska',NULL);
      INSERT INTO bill_comments (id,bill_id,user_id,is_public,moderation_status,approved_text) VALUES
        (1,7,1,true,'approved','Local public'),(2,7,2,true,'approved','Other district'),
        (3,7,3,true,'approved','Other state'),(4,7,1,false,'approved','Private'),
        (5,7,1,true,'draft','Draft'),(6,7,1,true,'rejected','Rejected'),
        (7,7,1,true,'approved',NULL),(8,8,1,true,'approved','Other bill'),
        (9,7,4,true,'approved','Unknown district');
      ALTER TABLE bill_comments ADD COLUMN rep_bioguide_id text;
      INSERT INTO reps VALUES ('H','Alice Smith','House of Representatives');
      UPDATE users SET last_name = 'Constituent' WHERE id=1;
      UPDATE bill_comments SET rep_bioguide_id = 'H' WHERE id=1;
      INSERT INTO comment_useful_votes VALUES (1,2);`);
    const location = { state: " alaska ", district: "0" };
    const counts = await getPublicBillCommentCounts([7,8,9,7], client, location);
    assert.deepEqual([...counts], [[7,1],[8,1],[9,0]]);
    for (const viewerUserId of [null, 2]) {
      const comments = await listPublicCommentsByBillId(7, { viewerUserId, location }, client);
      assert.deepEqual(comments.map(comment => comment.id), [1]);
      assert.equal(comments[0].author_display_name, 'Local Constituent');
      assert.equal(comments[0].recipient_name, 'Alice Smith');
      assert.equal(comments[0].recipient_chamber, 'House of Representatives');
      assert.equal(comments[0].useful_count, 1);
      assert.equal(comments[0].viewer_has_marked_useful, viewerUserId === 2);
    }
    assert.deepEqual((await listPublicCommentsByBillId(7, {
      location: { state: "Alaska", district: 1 },
    }, client)).map(comment => comment.id), [2]);
    assert.deepEqual(await listPublicCommentsByBillId(7, {
      location: { state: "Alaska", district: 2 },
    }, client), []);
  } finally { await client.query("ROLLBACK"); await client.end(); }
});

test("public discussions validate location and prefer the authenticated saved district", async () => {
  const original = db.query;
  const calls = [];
  db.query = async (sql, values) => { calls.push({ sql, values }); return { rows: [] }; };
  const app = express();
  app.use((req, _res, next) => {
    if (req.headers.authorization === "saved") req.user = { id: 42, state: "Alaska", district: 0 };
    if (req.headers.authorization === "missing") req.user = { id: 43, state: "Alaska", district: null };
    next();
  });
  app.use("/comments", router);
  // Match the production fallback: the router must handle its own validation errors.
  app.use((_err, _req, res, _next) => res.status(500).json({ error: "Unexpected error" }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/comments/bills/7/public`;
  try {
    for (const query of ["", "?state=Alaska", "?state=Alaska&district=-1", "?state=Alaska&district=0x0", "?state=Alaska&district=1&district=2", "?state=%20&district=0"]) {
      assert.equal((await fetch(base + query)).status, 400, query);
    }
    assert.equal(calls.length, 0);
    assert.equal((await fetch(base + "?state=%20Alaska%20&district=0")).status, 200);
    assert.deepEqual(calls.at(-1).values, [7, null, "Alaska", 0]);
    assert.equal((await fetch(base + "?state=Wyoming&district=9", { headers: { authorization: "saved" } })).status, 200);
    assert.deepEqual(calls.at(-1).values, [7, 42, "Alaska", 0]);
    assert.equal((await fetch(base + "?state=Wyoming&district=9", { headers: { authorization: "missing" } })).status, 400);
    assert.equal(calls.length, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.query = original;
  }
});

test("comment queries never fall back to nationwide when district is missing", async () => {
  const runner = { query: () => assert.fail("must reject before querying") };
  await assert.rejects(getPublicBillCommentCounts([7], runner), /district/i);
  await assert.rejects(listPublicCommentsByBillId(7, {}, runner), /district/i);
});
