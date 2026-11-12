import test from 'node:test';
import assert from 'node:assert/strict';
import pg from '../server/node_modules/pg/lib/index.js';
import { readFile } from 'node:fs/promises';

test('PostgreSQL: only the new morning schedule is active and sends within Eastern bounds', {
  skip: process.env.DELEGATION_TEST_POSTGRES !== '1',
}, async () => {
  const client = new pg.Client({ host:'127.0.0.1',port:55439,user:'postgres',database:'postgres' });
  await client.connect();
  try {
    await client.query('BEGIN');
    // Capture scheduled HTTP calls locally; no external service is invoked.
    await client.query(`CREATE SCHEMA cron; CREATE SCHEMA net; CREATE SCHEMA vault;
      CREATE TABLE cron.job(jobid bigserial,jobname text,schedule text,command text,active boolean DEFAULT true);
      INSERT INTO cron.job(jobname) VALUES ('send-vote-notifications-daily-1030-utc');
      CREATE FUNCTION cron.alter_job(job_id bigint, active boolean) RETURNS void LANGUAGE sql AS
        'UPDATE cron.job SET active=$2 WHERE jobid=$1';
      CREATE FUNCTION cron.schedule(job_name text,schedule text,command text) RETURNS bigint LANGUAGE sql AS
        'INSERT INTO cron.job(jobname,schedule,command) VALUES ($1,$2,$3) RETURNING jobid';
      CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
      INSERT INTO vault.decrypted_secrets VALUES ('project_url','https://example.test'),('edge_function_service_jwt','fake');
      CREATE TABLE net.calls(body jsonb);
      CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer)
        RETURNS bigint LANGUAGE plpgsql AS 'BEGIN INSERT INTO net.calls VALUES(body); RETURN 1; END';`);
    const sql = await readFile(new URL('../supabase/migrations/20261112182718_email_digest_morning_retries.sql',import.meta.url),'utf8');
    await client.query(sql);
    const jobs=(await client.query('SELECT * FROM cron.job ORDER BY jobid')).rows;
    assert.equal(jobs[0].active,false);
    assert.equal(jobs[1].active,true);
    assert.equal(jobs[1].schedule,'*/5 9-11 * * *');
    for(const [date,expected] of [
      ['2026-11-12T10:29:00Z',0],['2026-11-12T10:30:00Z',1],
      ['2026-11-12T11:25:00Z',1],['2026-11-12T11:30:00Z',0],
      ['2026-11-12T11:25:30Z',1],['2026-11-12T11:26:00Z',0],
      ['2026-07-12T09:30:00Z',1],['2026-07-12T10:25:00Z',1],['2026-07-12T10:30:00Z',0],
    ]) {
      await client.query('TRUNCATE net.calls');
      await client.query(jobs[1].command.replaceAll('now()',`'${date}'::timestamptz`));
      const calls=(await client.query('SELECT body FROM net.calls')).rows;
      assert.equal(calls.length,expected,date);
      if(calls.length) assert.equal(calls[0].body.mode,'scheduled');
    }
  } finally { await client.query('ROLLBACK');await client.end(); }
});
