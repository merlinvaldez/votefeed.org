import test from 'node:test';
import assert from 'node:assert/strict';
import pg from '../server/node_modules/pg/lib/index.js';
import { readFile } from 'node:fs/promises';

test('PostgreSQL: official publication invalidates title AI, unchanged text retains refreshed AI', {
  skip: process.env.DELEGATION_TEST_POSTGRES !== '1',
}, async () => {
  const client = new pg.Client({ host: '127.0.0.1', port: 55439, user: 'postgres', database: 'postgres' });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE bills (id int, summary text, aisummary text)');
    const migration = await readFile(new URL('../supabase/migrations/20261112180440_refresh_ai_on_official_summary.sql', import.meta.url), 'utf8').catch(() => '');
    assert.ok(migration, 'official summary cache invalidation migration must exist');
    await client.query(migration.replaceAll('public.bills', 'pg_temp.bills'));
    await client.query("INSERT INTO bills VALUES (1, '', 'title-based AI')");
    assert.equal((await client.query('SELECT aisummary FROM bills')).rows[0].aisummary, 'title-based AI');
    await client.query("UPDATE bills SET summary='<p>Published</p>' WHERE id=1");
    assert.equal((await client.query('SELECT aisummary FROM bills')).rows[0].aisummary, null);
    assert.equal((await client.query('SELECT ai_summary_needs_refresh FROM bills')).rows[0].ai_summary_needs_refresh, true);
    await client.query("UPDATE bills SET aisummary='fresh AI', summary='<p>Published</p>' WHERE id=1");
    assert.equal((await client.query('SELECT aisummary FROM bills')).rows[0].aisummary, 'fresh AI');
    assert.equal((await client.query('SELECT ai_summary_needs_refresh FROM bills')).rows[0].ai_summary_needs_refresh, false);
    await client.query("UPDATE bills SET summary='<p>Revised</p>' WHERE id=1");
    assert.equal((await client.query('SELECT aisummary FROM bills')).rows[0].aisummary, null);
    await client.query("INSERT INTO bills(id, summary, aisummary) VALUES (2, '<p>New bill</p>', 'old AI')");
    assert.equal((await client.query('SELECT ai_summary_needs_refresh FROM bills WHERE id=2')).rows[0].ai_summary_needs_refresh, true);
  } finally { await client.query('ROLLBACK'); await client.end(); }
});
