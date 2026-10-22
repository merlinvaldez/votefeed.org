import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from '../server/node_modules/pg/lib/index.js';
import express from '../server/node_modules/express/index.js';
import db from '../server/src/db/client.js';
import router from '../server/src/api/interactions.js';
import { saveBatchStances, validateBatchStanceRequest } from '../server/src/db/queries/batchStances.js';
import { getOrCreateCommentContactDrafts } from '../server/src/db/queries/comments.js';
import { getDelegationAlignment } from '../server/src/db/queries/alignment.js';
const body = { bill_id: 7, members: [{ rep_bioguide_id: 'S1', member_vote_id: 101 }, { rep_bioguide_id: 'S2', member_vote_id: 102 }], stance: 'approve' };
const postgresEnabled = process.env.BATCH_STANCES_TEST_POSTGRES === '1';

test('batch request rejects malformed, repeated and missing identities', () => {
  for (const invalid of [null, {}, { ...body, stance: undefined }, { ...body, stance: 'support' },
    { ...body, members: [body.members[0]] }, { ...body, members: [body.members[0], body.members[0]] },
    { ...body, bill_id: '7' }, { ...body, members: [body.members[0], { ...body.members[1], member_vote_id: -1 }] }]) {
    assert.throws(() => validateBatchStanceRequest(invalid), { status: 400 });
  }
});

test('PostgreSQL and HTTP: atomic batch, retries, clearing, authorization and failure rollback', { skip: !postgresEnabled }, async () => {
  const schema = `batch_test_${process.pid}`;
  const admin = new pg.Client({ host: '127.0.0.1', port: 55439, user: 'postgres', database: 'postgres', ssl: false });
  await admin.connect();
  const pool = new pg.Pool({ host: '127.0.0.1', port: 55439, user: 'postgres', database: 'postgres', ssl: false, options: `-c search_path=${schema}`, max: 4 });
  const originalConnect = db.connect;
  const originalQuery = db.query;
  let server;
  try {
    await admin.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema};
      CREATE TABLE users (id integer PRIMARY KEY, state text, district integer);
      CREATE TABLE reps (bioguideid text PRIMARY KEY, state text, chamber text, is_current_member boolean);
      CREATE TABLE bills (id integer PRIMARY KEY, number integer, bill_type text, legislation_url text);
      CREATE TABLE member_voting_record (id integer PRIMARY KEY, member_id text, chamber text, congress_number integer,
        session_number integer, roll_call_number integer, legislation_type text, legislationnumber integer, vote text, voted_on timestamptz);
      CREATE TABLE interactions (id serial PRIMARY KEY, user_id integer, bill_id integer, rep_bioguide_id text,
        member_vote_id integer, stance text NOT NULL, user_comment text);
      CREATE TABLE bill_comments (interaction_id integer, approved_text text, call_script text, message_template text, updated_at timestamptz);
      INSERT INTO users VALUES (1,'Alaska',0),(2,'Ohio',1);
      INSERT INTO reps VALUES ('S1','Alaska','Senate',true),('S2','Alaska','Senate',true);
      INSERT INTO bills VALUES (7,7,'hr','https://www.congress.gov/bill/119th-congress/house-bill/7');
      INSERT INTO member_voting_record VALUES (101,'S1','Senate',119,2,5,'hr',7,'Yea','2026-01-01'),
        (102,'S2','Senate',119,2,5,'hr',7,'Yea','2026-01-01');`);
    const migration = await readFile(new URL('../supabase/migrations/20261020171102_nullable_interaction_stance.sql', import.meta.url), 'utf8');
    await admin.query(migration.replaceAll('public.', `${schema}.`));
    await admin.query(`CREATE UNIQUE INDEX interactions_user_bill_member_event_unique
      ON interactions(user_id,bill_id,rep_bioguide_id,member_vote_id) WHERE member_vote_id IS NOT NULL`);
    await admin.query('ALTER TABLE reps ADD COLUMN full_name text, ADD COLUMN congressionaldistrict integer; ALTER TABLE bills ADD COLUMN policy_area text');
    const first = await saveBatchStances(1, body, pool);
    assert.equal(first.interactions.length, 2);
    const aligned = await getDelegationAlignment({ id: 1, state: 'Alaska', district: 0 }, { chamber: 'All Reps', runner: pool });
    assert.equal(aligned.percent, 100);
    assert.equal(aligned.comparableCount, 2);
    assert.equal(aligned.memberCount, 2);
    assert.deepEqual(aligned.members.map(member => member.memberId), ['S1', 'S2']);
    assert.equal(aligned.byChamber.House.hasData, false);
    assert.equal(aligned.byChamber.Senate.comparableCount, 2);
    const retries = await Promise.all(Array.from({ length: 4 }, () => saveBatchStances(1, body, pool)));
    for (const retry of retries) assert.deepEqual(retry, first);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM interactions')).rows[0].n, 2);
    await admin.query("UPDATE interactions SET user_comment='Keep legacy'; INSERT INTO bill_comments SELECT id,'Keep published','old call','old message',now() FROM interactions");
    const cleared = await saveBatchStances(1, { ...body, stance: null }, pool);
    const unaligned = await getDelegationAlignment({ id: 1, state: 'Alaska', district: 0 }, { chamber: 'All Reps', runner: pool });
    assert.equal(unaligned.comparableCount, 0);
    assert.equal(unaligned.hasData, false);
    assert.equal(unaligned.memberCount, 2);
    assert.ok(cleared.interactions.every(row => row.stance === null && row.user_comment === 'Keep legacy'));
    assert.ok((await admin.query('SELECT * FROM bill_comments')).rows.every(row => row.approved_text === 'Keep published' && row.call_script === null && row.message_template === null));
    assert.deepEqual(await saveBatchStances(1, { ...body, stance: null }, pool), cleared);
    for (const position of ['Not Voting', 'Present', 'Paired']) {
      await admin.query('UPDATE member_voting_record SET vote=$1', [position]);
      const approved = await saveBatchStances(1, body, pool);
      assert.ok(approved.interactions.every(row => row.stance === 'approve'));
      const agrees = await getDelegationAlignment({ id: 1, state: 'Alaska', district: 0 }, { chamber: 'All Reps', runner: pool });
      assert.equal(agrees.comparableCount, 2);
      assert.equal(agrees.percent, 100);
      await saveBatchStances(1, { ...body, stance: 'disapprove' }, pool);
      const disagrees = await getDelegationAlignment({ id: 1, state: 'Alaska', district: 0 }, { chamber: 'All Reps', runner: pool });
      assert.equal(disagrees.comparableCount, 2);
      assert.equal(disagrees.percent, 0);
    }
    await admin.query("UPDATE member_voting_record SET vote='Yea'");
    await saveBatchStances(1, { ...body, stance: null }, pool);
    await assert.rejects(saveBatchStances(2, body, pool), { status: 403 });
    await assert.rejects(saveBatchStances(999, body, pool), { status: 401 });
    await assert.rejects(saveBatchStances(1, { ...body, members: [body.members[0], { ...body.members[1], rep_bioguide_id: 'Other' }] }, pool), { status: 403 });
    for (const [column, value] of [['vote', "'Aye'"], ['vote', "'Present'"], ['roll_call_number', '6'], ['congress_number', '118'], ['session_number', '3']]) {
      const previous = (await admin.query(`SELECT ${column} FROM member_voting_record WHERE id=102`)).rows[0][column];
      await admin.query(`UPDATE member_voting_record SET ${column}=${value} WHERE id=102`);
      await assert.rejects(saveBatchStances(1, body, pool), { status: 400 });
      await admin.query(`UPDATE member_voting_record SET ${column}=$1 WHERE id=102`, [previous]);
    }
    await admin.query("UPDATE reps SET is_current_member=false WHERE bioguideid='S2'");
    await assert.rejects(saveBatchStances(1, body, pool), { status: 403 });
    await admin.query("UPDATE reps SET is_current_member=true");
    // Force failure on the second write after the first UPDATE succeeds.
    await admin.query(`ALTER TABLE interactions ADD CONSTRAINT injected_failure CHECK (rep_bioguide_id <> 'S2' OR stance IS DISTINCT FROM 'disapprove')`);
    await assert.rejects(saveBatchStances(1, { ...body, stance: 'disapprove' }, pool));
    assert.ok((await admin.query('SELECT stance FROM interactions')).rows.every(row => row.stance === null));
    await admin.query('ALTER TABLE interactions DROP CONSTRAINT injected_failure');
    await admin.query("INSERT INTO users VALUES (3,'Alaska',0); ALTER TABLE interactions ADD CONSTRAINT injected_insert_failure CHECK (user_id <> 3 OR rep_bioguide_id <> 'S2')");
    await assert.rejects(saveBatchStances(3, body, pool));
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM interactions WHERE user_id=3')).rows[0].n, 0);
    await admin.query('ALTER TABLE interactions DROP CONSTRAINT injected_insert_failure');
    await admin.query("UPDATE bills SET legislation_url='https://www.congress.gov.evil/bill/119th-congress/house-bill/7'");
    await assert.rejects(saveBatchStances(1, body, pool), { status: 400 });
    await admin.query("UPDATE bills SET legislation_url='https://www.congress.gov/bill/119th-congress/house-bill/7'");
    db.connect = () => pool.connect();
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.auth = () => ({ userId: req.headers.authorization ? 'clerk' : null }); req.user = req.headers.authorization ? { id: 1 } : null; next(); });
    app.use('/interactions', router);
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/interactions/stances/batch`;
    const send = (payload, auth = true) => fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'test' } : {}) }, body: JSON.stringify(payload) });
    assert.equal((await send(body, false)).status, 401);
    assert.equal((await send({})).status, 400);
    const response = await send({ ...body, user_id: 2 });
    assert.equal(response.status, 200);
    assert.ok((await response.json()).interactions.every(row => row.user_id === 1 && row.stance === 'approve'));
    // Single-member clearing uses the existing owned update route, not DELETE.
    db.query = (sql, params) => pool.query(sql, params);
    for (const position of ['Not Voting', 'Present']) {
      await admin.query('UPDATE member_voting_record SET vote=$1 WHERE id=101', [position]);
      const saved = await fetch(url.replace('stances/batch', `${first.interactions[0].id}/stance`), {
        method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'test' },
        body: JSON.stringify({ stance: 'approve', member_vote_id: 101 }),
      });
      assert.equal(saved.status, 201);
      assert.equal((await saved.json()).stance, 'approve');
    }
    await admin.query("UPDATE member_voting_record SET vote='Yea' WHERE id=101");
    const interactionId = first.interactions[0].id;
    const singleUrl = url.replace('stances/batch', `${interactionId}/stance`);
    const clearSingle = (payload, auth = true) => fetch(singleUrl, { method: 'PUT',
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'test' } : {}) },
      body: JSON.stringify(payload) });
    assert.equal((await clearSingle({ stance: null }, false)).status, 401);
    assert.equal((await clearSingle({})).status, 400);
    assert.equal((await clearSingle({ stance: 'invalid' })).status, 400);
    assert.equal((await clearSingle({ stance: null, member_vote_id: 102 })).status, 400);
    await admin.query("INSERT INTO interactions (user_id,bill_id,rep_bioguide_id,member_vote_id,stance) VALUES (2,7,'S1',101,'approve')");
    const otherId = (await admin.query('SELECT id FROM interactions WHERE user_id=2')).rows[0].id;
    assert.equal((await fetch(url.replace('stances/batch', `${otherId}/stance`), {
      method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'test' },
      body: JSON.stringify({ stance: null }),
    })).status, 403);
    await admin.query("UPDATE bill_comments SET call_script='stale', message_template='stale'");
    const result = await clearSingle({ stance: null, member_vote_id: 101 });
    assert.equal(result.status, 200);
    const clearedSingle = await result.json();
    assert.equal(clearedSingle.id, interactionId);
    assert.equal(clearedSingle.stance, null);
    assert.equal(clearedSingle.member_vote_id, 101);
    assert.equal(clearedSingle.user_comment, 'Keep legacy');
    assert.deepEqual(await (await clearSingle({ stance: null })).json(), clearedSingle);
    const comment = (await admin.query('SELECT * FROM bill_comments WHERE interaction_id=$1', [interactionId])).rows[0];
    assert.equal(comment.approved_text, 'Keep published');
    assert.equal(comment.call_script, null);
    assert.equal(comment.message_template, null);
    assert.equal((await admin.query('SELECT stance FROM interactions WHERE id=$1', [first.interactions[1].id])).rows[0].stance, 'approve');
    await assert.rejects(getOrCreateCommentContactDrafts({ interactionId, expectedStance: 'approve',
      generateDrafts: () => assert.fail('stale stance must not generate') }, pool), { status: 409 });
    await assert.rejects(getOrCreateCommentContactDrafts({ interactionId, expectedStance: null,
      generateDrafts: async () => {
        await saveBatchStances(1, body, pool);
        return { callScript: 'Old stance call', messageTemplate: 'Old stance message' };
      } }, pool), { status: 409 });
    assert.equal((await admin.query('SELECT call_script FROM bill_comments WHERE interaction_id=$1', [interactionId])).rows[0].call_script, null);
    await assert.rejects(getOrCreateCommentContactDrafts({ interactionId, expectedStance: 'approve',
      generateDrafts: async () => {
        await admin.query("UPDATE bill_comments SET approved_text='New comment', updated_at=now() WHERE interaction_id=$1", [interactionId]);
        return { callScript: 'Old comment call', messageTemplate: 'Old comment message' };
      } }, pool), { status: 409 });
    const fresh = await getOrCreateCommentContactDrafts({ interactionId, expectedStance: 'approve',
      generateDrafts: async comment => ({ callScript: `Call: ${comment.approved_text}`, messageTemplate: 'Current message' }) }, pool);
    assert.equal(fresh.callScript, 'Call: New comment');
    const cached = await getOrCreateCommentContactDrafts({ interactionId, expectedStance: 'approve',
      generateDrafts: () => assert.fail('reuse current cache') }, pool);
    assert.equal(cached.source, 'cache');
  } finally {
    db.connect = originalConnect;
    db.query = originalQuery;
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
