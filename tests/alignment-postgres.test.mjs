import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import express from "../server/node_modules/express/index.js";
import pg from "../server/node_modules/pg/lib/index.js";
import db from "../server/src/db/client.js";
import { getDelegationAlignment } from "../server/src/db/queries/alignment.js";
import { addStance, updateStance } from "../server/src/db/queries/interactions.js";
import { validateStanceVoteLink, findMemberVoteForBill } from "../server/src/db/queries/memberVoteLinks.js";
import usersRouter from "../server/src/api/users.js";
import interactionsRouter from "../server/src/api/interactions.js";

const enabled = process.env.ALIGNMENT_TEST_POSTGRES === "1";

test("isolated PostgreSQL: migration, pair query, summaries and answer updates", { skip: !enabled }, async () => {
  // This test owns only a unique schema on the fixed local test server.
  const client = new pg.Client({ host: "127.0.0.1", port: 55439, user: "postgres", database: "postgres", ssl: false });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("CREATE SCHEMA alignment_test; SET LOCAL search_path TO alignment_test, public");
    await client.query(`CREATE TABLE users (id serial PRIMARY KEY, state text, district integer);
      CREATE TABLE reps (bioguideid text PRIMARY KEY, full_name text, state text, congressionaldistrict integer, chamber text, is_current_member boolean);
      CREATE TABLE bills (id serial PRIMARY KEY, number integer, bill_type text, policy_area text);
      CREATE TABLE member_voting_record (id serial PRIMARY KEY, legislationnumber integer, legislation_type text, member_id text,
        chamber text, congress_number integer, session_number integer, roll_call_number integer, vote text, voted_on timestamptz);
      CREATE TABLE interactions (id serial PRIMARY KEY, user_id integer, bill_id integer, rep_bioguide_id text, stance text);
      CREATE TABLE bill_comments (interaction_id integer, call_script text, message_template text, updated_at timestamptz);`);
    const migration = await readFile(new URL("../supabase/migrations/20261009154322_link_alignment_stances_to_member_votes.sql", import.meta.url), "utf8");
    // Run the exact migration statements against the isolated schema.
    await client.query(migration.replaceAll("public.", "alignment_test."));
    await client.query(`INSERT INTO users VALUES (1, 'New York', 0), (2, 'New York', 0);
      INSERT INTO reps VALUES ('H','House member','New York',0,'House of Representatives',true),
        ('S1','Senator A','New York',null,'Senate',true), ('S2','Senator B','New York',null,'Senate',true),
        ('X','Former senator','New York',null,'Senate',false);
      INSERT INTO bills VALUES (7,7,'hr','Health'), (8,8,'hr','Education');
      INSERT INTO member_voting_record (legislationnumber,legislation_type,member_id,chamber,congress_number,session_number,roll_call_number,vote,voted_on)
      SELECT 7,'hr','H','House',119,1,n,CASE WHEN n <= 80 THEN 'Yea' ELSE 'No' END, '2026-01-01'::timestamptz + n * interval '1 day'
      FROM generate_series(1,100) n;
      INSERT INTO member_voting_record VALUES (101,7,'hr','S1','Senate',119,1,1,'Yea','2026-04-01'),
        (102,7,'hr','S2','Senate',119,1,1,'Aye','2026-04-01'),
        (103,8,'hr','H','House',119,1,101,'Nay','2026-04-11'),
        (104,7,'hr','H','House',119,1,102,'Present','2026-04-12');
      INSERT INTO interactions (user_id,bill_id,rep_bioguide_id,stance,member_vote_id)
      SELECT 1,7,'H',CASE WHEN id <= 80 THEN 'approve' ELSE 'disapprove' END,id FROM member_voting_record WHERE member_id='H' AND id <= 100;
      INSERT INTO interactions (user_id,bill_id,rep_bioguide_id,stance,member_vote_id) VALUES
        (1,7,'S1','approve',101),(1,7,'S2','approve',102),
        (1,7,'H','approve',null),(2,7,'H','approve',1),
        (1,7,'H','approve',104),(1,8,'H','approve',1),(1,7,'S1','approve',1);`);

    const user = { id: 1, state: "New York", district: 0 };
    const result = await getDelegationAlignment(user, { chamber: "All Reps", policyArea: "Health", runner: client });
    assert.equal(result.percent, 93);
    assert.equal(result.agreementCount, 82);
    assert.equal(result.comparableCount, 102);
    assert.equal(result.byChamber.House.percent, 80);
    assert.equal(result.byChamber.Senate.percent, 100);
    assert.equal(result.membersWithData, 3);

    const empty = await getDelegationAlignment(user, { policyArea: "Education", runner: client });
    assert.equal(empty.percent, null);
    assert.equal(empty.emptyMessage, "No alignment data yet");
    assert.equal(await validateStanceVoteLink({ billId: 8, memberId: "H", memberVoteId: 103 }, client), null);
    assert.match(await validateStanceVoteLink({ billId: 7, memberId: "H", memberVoteId: 103 }, client), /does not match/);
    assert.match(await validateStanceVoteLink({ billId: 7, memberId: "S1", memberVoteId: 1 }, client), /does not match/);
    assert.match(await validateStanceVoteLink({ billId: 7, memberId: "H", memberVoteId: 104 }, client), /cannot be compared/);
    assert.match(await validateStanceVoteLink({ billId: 7, memberId: "H", memberVoteId: 1, existingVoteId: 2 }, client), /different voting event/);
    assert.equal((await findMemberVoteForBill("H", 8, client)).member_vote_id, 103);

    const added = await addStance(1, 8, "H", "approve", 103, client);
    assert.equal(added.member_vote_id, 103);
    const changed = await updateStance(added.id, "disapprove", 103, client);
    assert.equal(changed.member_vote_id, 103);
    const education = await getDelegationAlignment(user, { policyArea: "Education", runner: client });
    assert.equal(education.percent, 0);
    assert.equal(education.comparableCount, 1);
    assert.equal(education.byChamber["All Reps"].membersWithData, 1);
    await client.query("DELETE FROM interactions WHERE id=$1", [added.id]);
    assert.equal((await getDelegationAlignment(user, { policyArea: "Education", runner: client })).hasData, false);

    const originalQuery = db.query;
    db.query = client.query.bind(client);
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.auth = () => ({ userId: req.headers.authorization === "Bearer test-user" ? "test-clerk" : null });
      req.user = user;
      next();
    });
    app.use("/users", usersRouter);
    app.use("/interactions", interactionsRouter);
    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { Authorization: "Bearer test-user", "Content-Type": "application/json" };
    try {
      assert.equal((await fetch(`${base}/users/me/alignment`)).status, 401);
      assert.equal((await fetch(`${base}/users/me/alignment?chamber=invalid`, { headers })).status, 400);
      assert.equal((await fetch(`${base}/users/me/alignment?repBioguideId=X`, { headers })).status, 400);
      const all = await (await fetch(`${base}/users/me/alignment?chamber=All%20Reps&policyArea=Health`, { headers })).json();
      assert.equal(all.percent, 93);
      assert.equal(all.byChamber.House.percent, 80);

      const createResponse = await fetch(`${base}/interactions/addstance`, { method: "POST", headers,
        body: JSON.stringify({ user_id: 2, bill_id: 8, rep_bioguide_id: "H", stance: "approve", member_vote_id: 103 }),
      });
      assert.equal(createResponse.status, 201);
      const created = await createResponse.json();
      assert.equal(created.user_id, 1);
      let summary = await (await fetch(`${base}/users/me/alignment?policyArea=Education`, { headers })).json();
      assert.equal(summary.percent, 100);
      const changeResponse = await fetch(`${base}/interactions/${created.id}/stance`, {
        method: "PUT", headers, body: JSON.stringify({ stance: "disapprove", member_vote_id: 103 }),
      });
      assert.equal(changeResponse.status, 201);
      summary = await (await fetch(`${base}/users/me/alignment?policyArea=Education`, { headers })).json();
      assert.equal(summary.percent, 0);
      const eventMove = await fetch(`${base}/interactions/${created.id}/stance`, {
        method: "PUT", headers, body: JSON.stringify({ stance: "approve", member_vote_id: 1 }),
      });
      assert.equal(eventMove.status, 400);
      const { rows: [otherUser] } = await client.query("SELECT id FROM interactions WHERE user_id=2 LIMIT 1");
      assert.equal((await fetch(`${base}/interactions/${otherUser.id}/stance`, {
        method: "PUT", headers, body: JSON.stringify({ stance: "approve" }),
      })).status, 403);
      assert.equal((await fetch(`${base}/interactions/${created.id}`, { method: "DELETE", headers })).status, 201);
      summary = await (await fetch(`${base}/users/me/alignment?policyArea=Education`, { headers })).json();
      assert.equal(summary.percent, null);
      assert.equal(summary.hasData, false);
    } finally {
      await new Promise(resolve => server.close(resolve));
      db.query = originalQuery;
    }
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
