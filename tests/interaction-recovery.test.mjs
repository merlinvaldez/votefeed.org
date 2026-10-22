import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from '../server/node_modules/pg/lib/index.js';
import { addStance } from '../server/src/db/queries/interactions.js';
import { getCardResponseState } from '../client/src/voteInteractions.js';

test('PostgreSQL: legacy House recovery preserves answers and comments; future retries retain one event',
  { skip: process.env.ALIGNMENT_TEST_POSTGRES !== '1' }, async () => {
    const client = new pg.Client({ host: '127.0.0.1', port: 55439, user: 'postgres', database: 'postgres' });
    await client.connect();
    const schema = `recovery_${process.pid}`;
    try {
      await client.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema};
        CREATE TABLE bills(id integer PRIMARY KEY, number integer, bill_type text, legislation_url text);
        CREATE TABLE member_voting_record(id integer PRIMARY KEY, member_id text, chamber text,
          congress_number integer, session_number integer, roll_call_number integer,
          legislation_type text, legislationnumber integer, voted_on timestamptz, vote text);
        CREATE TABLE interactions(id serial PRIMARY KEY, user_id integer, bill_id integer,
          rep_bioguide_id text, stance text, member_vote_id integer REFERENCES member_voting_record(id) ON DELETE SET NULL);
        CREATE TABLE bill_comments(interaction_id integer, approved_text text);
        INSERT INTO bills VALUES (1,7,'hr',null),(2,8,'hr',null),(3,9,'hr',null);
        INSERT INTO member_voting_record VALUES
          (10,'H','House',119,2,1,'hr',7,'2026-01-01','Yea'),
          (11,'H','House',119,2,2,'hr',7,'2026-02-01','Nay'),
          (12,'S','Senate',119,2,3,'hr',7,'2026-03-01','Yea'),
          (13,'H','House',118,2,4,'hr',8,'2024-01-01','Yea'),
          (14,'H','House',119,2,5,'hr',8,'2026-01-01','Nay');
        INSERT INTO interactions(user_id,bill_id,rep_bioguide_id,stance,member_vote_id) VALUES
          (1,1,'H','approve',null),(2,1,'H','disapprove',null),(3,1,'S','approve',12),
          (4,2,'H','approve',null),(5,3,'H','approve',null);
        INSERT INTO bill_comments VALUES (1,'Preserve published comment');`);
      const recovery = (await readFile(new URL('../supabase/migrations/20261022171033_recover_legacy_house_responses.sql', import.meta.url), 'utf8')).replaceAll('public.', `${schema}.`);
      await client.query(recovery);
      await client.query(recovery); // Safe to rerun without moving existing links.
      const { rows } = await client.query('SELECT * FROM interactions ORDER BY id');
      assert.deepEqual(rows.map(r => r.member_vote_id), [11,11,12,null,null]);
      assert.deepEqual(rows.map(r => r.stance), ['approve','disapprove','approve','approve','approve']);
      assert.equal((await client.query('SELECT approved_text FROM bill_comments')).rows[0].approved_text, 'Preserve published comment');
      assert.match((await client.query('SELECT legislation_url FROM bills WHERE id=1')).rows[0].legislation_url, /119th-congress\/house-bill\/7$/);
      assert.equal((await client.query('SELECT legislation_url FROM bills WHERE id=2')).rows[0].legislation_url, null);
      const state = getCardResponseState({ bill: { id: 1 }, members: [{ bioguideId: 'H', memberVoteId: 11, chamber: 'House' }] }, rows);
      assert.equal(state.stance, 'disapprove');
      const protection = (await readFile(new URL('../supabase/migrations/20261022171058_protect_response_vote_identity.sql', import.meta.url), 'utf8')).replaceAll('public.', `${schema}.`);
      await client.query(protection);
      const retries = await Promise.all(Array.from({ length: 4 }, () => addStance(1,1,'H','approve',11,client)));
      assert.ok(retries.every(r => r.id === 1 && r.member_vote_id === 11));
      assert.equal((await client.query('SELECT count(*)::int AS n FROM interactions')).rows[0].n, 5);
      await assert.rejects(client.query("INSERT INTO interactions(user_id,bill_id,rep_bioguide_id,stance) VALUES (9,1,'H','approve')"), { code: '23514' });
      await assert.rejects(client.query('DELETE FROM member_voting_record WHERE id=11'), error =>
        ['23503','23001'].includes(error.code));
    } finally {
      await client.query(`DROP SCHEMA ${schema} CASCADE`);
      await client.end();
    }
  });
