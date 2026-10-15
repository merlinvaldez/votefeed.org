import test from "node:test";
import assert from "node:assert/strict";
import pg from "../server/node_modules/pg/lib/index.js";
import { readFile } from "node:fs/promises";
import { findLatestDelegationVotes, readDelegationFeedRecords } from "../server/src/db/queries/delegationVotes.js";
import { readDelegationFeedPage } from "../server/src/db/queries/delegationFeedPage.js";

test("an empty delegation does not query votes", async () => {
  assert.deepEqual(await findLatestDelegationVotes({ houseMember: null, senators: [] }, {
    query: () => assert.fail("no members to query"),
  }), []);
});

test("PostgreSQL: shared delegation read selects latest eligible member measures", {
  skip: process.env.DELEGATION_TEST_POSTGRES !== "1",
}, async () => {
  const client = new pg.Client({ host: "127.0.0.1", port: 55439, user: "postgres", database: "postgres", ssl: false });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TEMP TABLE reps (bioguideid text, chamber text, state text,
      congressionaldistrict integer, is_current_member boolean, full_name text, image_url text);
      CREATE TEMP TABLE bills (id integer, number integer, bill_type text, legislation_url text,
        title text, policy_area text, summary text, aisummary text);
      CREATE TEMP TABLE member_voting_record (id integer, member_id text, chamber text,
        congress_number integer, session_number integer, roll_call_number integer,
        legislation_type text, legislationnumber integer, voted_on timestamptz, vote text);
      INSERT INTO reps (bioguideid,chamber,state,congressionaldistrict,is_current_member)
      VALUES ('H','House of Representatives','Alaska',0,true),
        ('S1','Senate','Alaska',null,true),('S2','Senate','Alaska',null,true),
        ('X','Senate','Alaska',null,false);
      UPDATE reps SET full_name = 'House Member', image_url = 'https://example.com/house.jpg' WHERE bioguideid = 'H';
      UPDATE reps SET full_name = 'Senator One' WHERE bioguideid = 'S1';
      INSERT INTO bills (id,number,bill_type,legislation_url) VALUES
        (7,7,'hr','https://www.congress.gov/bill/119th-congress/house-bill/7'),
        (8,8,'s','https://www.congress.gov/bill/118th-congress/senate-bill/8'),
        (9,9,'hr',null);
      UPDATE bills SET title = 'Example bill', policy_area = 'Health',
        summary = '<p>Official summary</p>', aisummary = 'Simple summary' WHERE id = 7;
      INSERT INTO member_voting_record VALUES
        (1,'H','House',119,1,1,'hr',7,'2026-01-01','Yea'),
        (2,'H','House',119,2,1,'hr',7,'2026-02-01','Nay'),
        (3,'S1','Senate',119,2,1,'hr',7,'2026-02-01','Yea'),
        (4,'S2','Senate',119,2,1,'hr',7,'2026-02-01','Aye'),
        (5,'X','Senate',119,2,1,'hr',7,'2026-02-01','Yea'),
        (6,'H','Senate',119,2,1,'hr',7,'2026-02-01','Yea'),
        (7,'H','House',118,2,1,'hr',7,'2026-03-01','Yea'),
        (8,'S1','Senate',118,2,1,'s',8,'2025-01-01','Not Voting'),
        (9,'S1','Senate',119,2,2,'s',8,'2026-03-01','Yea'),
        (10,'H','House',119,2,2,'hr',9,'2026-03-01','Yea'),
        (11,'H','House',119,2,null,'hr',7,'2026-04-01','Yea'),
        (12,'H','House',119,2,3,'hr',7,'2026-04-01',''),
        (13,'H','House',119,2,4,'hr',77,'2026-04-01','Yea'),
        (14,'H','House',119,2,5,'hr',7,null,'Yea');`);
    const saved = await readDelegationFeedRecords({ state: "Alaska", district: 0 }, { runner: client });
    const guest = await readDelegationFeedRecords({ state: " Alaska ", district: "0" }, { runner: client });
    assert.deepEqual(saved, guest);
    assert.deepEqual(saved.votes.map(row => row.member_vote_id), [2, 3, 4, 8]);
    assert.deepEqual(saved.votes.map(row => row.vote), ["Nay", "Yea", "Aye", "Not Voting"]);
    await client.query("CREATE SCHEMA delegation_snapshot_test");
    const migration = await readFile(new URL("../supabase/migrations/20261014192544_legislative_feed_snapshots.sql", import.meta.url), "utf8");
    await client.query(migration.replaceAll("public.", "delegation_snapshot_test."));
    const runner = { query: (sql, params) => client.query(sql.replaceAll(
      "public.legislative_feed_snapshots", "delegation_snapshot_test.legislative_feed_snapshots"), params) };
    const location = { state: "Alaska", district: 0 };
    const firstPage = await readDelegationFeedPage(location, { runner, userId: 1, limit: 2 });
    assert.equal(firstPage.cards.length, 2);
    assert.equal(firstPage.page.hasMore, true);
    assert.equal(firstPage.totalPolicyCount, 4);
    assert.equal(firstPage.filteredCardCount, 4);
    assert.deepEqual(firstPage.policyAreas, [{ name: "Health", count: 3 }]);
    const continuation = { runner, userId: 1, limit: 2, cursor: firstPage.page.nextCursor };
    // New latest actions must appear only on refresh, not in the stored pages.
    await client.query(`INSERT INTO member_voting_record VALUES
      (90,'S1','Senate',119,2,90,'hr',7,'2026-05-01 00:00:00.000001+00','Nay')`);
    const secondPage = await readDelegationFeedPage(location, continuation);
    assert.equal(secondPage.page.hasMore, false);
    assert.equal(secondPage.page.nextCursor, null);
    assert.equal(secondPage.page.snapshotId, firstPage.page.snapshotId);
    assert.equal(secondPage.totalPolicyCount, 4);
    assert.deepEqual(secondPage.policyAreas, firstPage.policyAreas);
    assert.deepEqual([...firstPage.cards, ...secondPage.cards].map(card => card.id).sort(),
      saved.cards.map(card => card.id).sort());
    assert.deepEqual(await readDelegationFeedPage(location, continuation), secondPage);
    const refreshed = await readDelegationFeedPage(location, { runner, userId: 1, limit: 2 });
    assert.equal(refreshed.cards[0].members[0].memberVoteId, 90);
    assert.equal(refreshed.cards[0].votedOn, "2026-05-01T00:00:00.000001Z");
    await assert.rejects(readDelegationFeedPage(location, { ...continuation, userId: 2 }), { status: 403 });
    await client.query("UPDATE member_voting_record SET vote = 'Present' WHERE id = 3");
    await assert.rejects(readDelegationFeedPage(location, continuation), { status: 409, code: "FEED_RESTART_REQUIRED" });
    await client.query("UPDATE member_voting_record SET vote = 'Yea' WHERE id = 3; DELETE FROM member_voting_record WHERE id = 90");
    assert.equal(saved.cards.length, 4);
    const health = await readDelegationFeedRecords({ state: "Alaska", district: 0 }, { runner: client, policyArea: "Health" });
    assert.equal(health.cards.length, 3);
    assert.equal(health.totalPolicyCount, 4);
    assert.equal(health.filteredCardCount, 3);
    await client.query("UPDATE member_voting_record SET vote = 'Yea' WHERE id = 4");
    const combined = await readDelegationFeedRecords({ state: "Alaska", district: 0 }, { runner: client });
    assert.equal(combined.cards.length, 3);
    assert.equal(combined.totalPolicyCount, 3);
    assert.deepEqual(combined.policyAreas, [{ name: "Health", count: 2 }]);
    const filteredPage = await readDelegationFeedPage(location, { runner, limit: 1, policyArea: "Health" });
    assert.equal(filteredPage.totalPolicyCount, 3);
    assert.equal(filteredPage.filteredCardCount, 2);
    const filteredNext = await readDelegationFeedPage(location, { runner, limit: 1,
      policyArea: "Health", cursor: filteredPage.page.nextCursor });
    assert.equal(filteredNext.page.hasMore, false);
    assert.equal(filteredNext.filteredCardCount, 2);
    assert.deepEqual(filteredNext.policyAreas, filteredPage.policyAreas);
    const noMatches = await readDelegationFeedPage(location, { runner, policyArea: "Education" });
    assert.equal(noMatches.totalPolicyCount, 3);
    assert.equal(noMatches.filteredCardCount, 0);
    assert.equal(noMatches.cards.length, 0);
    assert.equal(noMatches.emptyReason, "NO_POLICY_MATCHES");
    assert.equal(noMatches.page.nextCursor, null);
    assert.deepEqual(combined.cards.find(card => card.members.length === 2).members.map(member => member.memberVoteId), [3, 4]);
    await client.query("UPDATE member_voting_record SET vote = 'Aye' WHERE id = 4");
    assert.equal(saved.votes[3].congress_number, 118);
    assert.deepEqual(saved.votes[0].member, {
      bioguideId: "H", memberVoteId: 2, name: "House Member", chamber: "House",
      portrait: "https://example.com/house.jpg",
    });
    assert.deepEqual(saved.votes[1].member, {
      bioguideId: "S1", memberVoteId: 3, name: "Senator One", chamber: "Senate", portrait: null,
    });
    assert.equal(saved.votes[2].member.name, "S2");
    assert.equal(saved.votes[2].member.memberVoteId, 4);
    assert.deepEqual(saved.votes[0].bill, {
      id: 7, congress: 119, type: "hr", number: 7, title: "Example bill", policyArea: "Health",
      legislationUrl: "https://www.congress.gov/bill/119th-congress/house-bill/7",
    });
    assert.deepEqual(saved.votes[0].summary, {
      officialHtml: "<p>Official summary</p>", simplifiedText: "Simple summary",
    });
    assert.equal(saved.votes[3].bill.congress, 118);
    assert.deepEqual(saved.votes[3].summary, { officialHtml: null, simplifiedText: null });
    // Same number cannot link a different type; URL prefixes and hosts cannot
    // impersonate the exact measure identity.
    for (const url of [
      "https://www.congress.gov/bill/119th-congress/house-bill/70",
      "https://www.congress.gov/bill/119th-congress/senate-bill/7",
      "https://www.congress.gov.evil.test/bill/119th-congress/house-bill/7",
    ]) {
      await client.query("UPDATE bills SET legislation_url = $1 WHERE id = 7", [url]);
      const mismatched = await readDelegationFeedRecords({ state: "Alaska", district: 0 }, { runner: client });
      assert.deepEqual(mismatched.votes.map(row => row.member_vote_id), [8]);
    }
    await client.query("UPDATE bills SET legislation_url = $1 WHERE id = 7", [saved.votes[0].bill.legislationUrl]);
    // Tie-breaking is deterministic even without the normal unique index.
    await client.query(`INSERT INTO member_voting_record VALUES
      (15,'H','House',119,2,1,'hr',7,'2026-02-01','Nay');`);
    const tied = await readDelegationFeedRecords({ state: "Alaska", district: 0 }, { runner: client });
    assert.equal(tied.votes[0].member_vote_id, 15);
    assert.equal(tied.diagnostics[0].code, "DUPLICATE_VOTE_RECORDS");
    await client.query("UPDATE member_voting_record SET vote = 'Yea' WHERE id = 15");
    const conflict = await readDelegationFeedRecords({ state: "Alaska", district: 0 }, { runner: client });
    assert.equal(conflict.dataStatus, "partial");
    assert.equal(conflict.warnings[0].code, "CONFLICTING_VOTE_RECORDS");
    assert.equal(conflict.votes.find(row => row.member_id === 'H').member_vote_id, 1);
    await client.query("DELETE FROM reps WHERE bioguideid = 'H'");
    const vacant = await readDelegationFeedRecords({ state: "Alaska", district: 0 }, { runner: client });
    assert.equal(vacant.delegation.houseMember, null);
    assert.deepEqual(vacant.votes.map(row => row.member_id), ["S1", "S2", "S1"]);
    await client.query("DELETE FROM member_voting_record");
    const noVotes = await readDelegationFeedRecords(location, { runner: client });
    assert.equal(noVotes.emptyReason, "NO_ELIGIBLE_VOTES");
    assert.equal(noVotes.dataStatus, "complete");
    await client.query(`INSERT INTO member_voting_record VALUES
      (100,'S1','Senate',119,2,1,'hr',7,'2026-02-01','Yea'),
      (101,'S1','Senate',119,2,1,'hr',7,'2026-02-01','Nay')`);
    const invalid = await readDelegationFeedRecords(location, { runner: client, policyArea: "Education" });
    assert.equal(invalid.emptyReason, "INVALID_VOTE_DATA");
    assert.equal(invalid.dataStatus, "partial");
    assert.equal(invalid.retry.mode, "refresh");
    await client.query("DELETE FROM reps");
    assert.equal((await readDelegationFeedRecords(location, { runner: client })).emptyReason, "NO_DELEGATION");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
