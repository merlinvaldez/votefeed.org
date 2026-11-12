import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { officialBillUrl } from '../supabase/functions/_shared/billUrl.ts';
import { json } from '../supabase/functions/_shared/http.ts';

const source = stripTypeScriptTypes(await readFile(new URL('../supabase/functions/sync-votes/index.ts', import.meta.url), 'utf8'));
const start = source.indexOf('async function backfillMissingOfficialSummaries(');
const end = source.indexOf('async function ensureHouseBillTitles(', start);

test('daily sync repairs published summaries independently of vote dates and notification eligibility', async () => {
  assert.ok(start >= 0, 'daily missing-summary repair must exist');
  const rows = [
    { id: 1, bill_type: 'hr', number: 9612, legislation_url: officialBillUrl(119, 'hr', 9612) },
    { id: 2, bill_type: 'sjres', number: 99, legislation_url: officialBillUrl(119, 'sjres', 99) },
    { id: 3, bill_type: 'hres', number: 1650, legislation_url: officialBillUrl(119, 'hres', 1650) },
    { id: 4, bill_type: 'hr', number: 7, legislation_url: officialBillUrl(118, 'hr', 7) },
  ];
  const calls = [], filters = [];
  const client = { from(table) {
    assert.equal(table, 'bills');
    const q = { select() { return q; }, or(value) { filters.push(value); return q; },
      order() { return q; }, range(from, to) { return Promise.resolve({ data: rows.slice(from, to + 1), error: null }); } };
    return q;
  } };
  const repair = runInNewContext(`${source.slice(start, end)}; backfillMissingOfficialSummaries`, {
    officialBillUrl, console,
    backfillOneBill: async (_client, _key, bill) => {
      calls.push(bill);
      if (bill.billType === 'sjres') throw new Error('temporary upstream failure');
      return { changed: bill.number === 9612, summaryFound: bill.number === 9612 };
    },
  });
  const result = await repair(client, 'test');
  assert.deepEqual(calls.map(b => `${b.billType}:${b.number}`), ['hr:9612', 'sjres:99', 'hres:1650']);
  assert.ok(filters.includes('summary.is.null,summary.eq.'));
  assert.equal(result.repairedCount, 1);
  assert.equal(result.unavailableCount, 1);
  assert.equal(result.failures.length, 1);
  assert.match(source, /await backfillMissingOfficialSummaries\(supabase, congressApiKey\)/);
});

test('service-only repair restores official HTML through the real Congress lookup without syncing votes', async () => {
  const bill = { id: 18559, bill_type: 'hr', number: 9612, title: 'Title', summary: '',
    legislation_url: officialBillUrl(119, 'hr', 9612) };
  const writes = [], requests = [];
  const client = { from(table) {
    assert.equal(table, 'bills', 'repair must not touch votes or notification queues');
    let update;
    const q = { select() { return q; }, or() { return q; }, order() { return q; },
      range() { return q; }, eq() { return q; }, limit() { return q; },
      update(value) { update = value; return q; },
      then(resolve, reject) {
        if (update) { writes.push(update); Object.assign(bill, update); }
        return Promise.resolve({ data: [bill], error: null }).then(resolve, reject);
      } };
    return q;
  } };
  let handler;
  runInNewContext(source.replace(/^import .*;\r?$/gm, ''), {
    Deno: { env: { get: () => 'test' }, serve(fn) { handler = fn; } },
    createClient: () => client, officialBillUrl, json, console, URL, AbortSignal,
    atob, Response, Request, setTimeout,
    fetch: async url => { requests.push(String(url)); return Response.json({ summaries: [
      { text: '<p>Older version</p>', updateDate: '2026-10-01T00:00:00Z' },
      { text: '<p>Official published summary</p>', updateDate: '2026-11-05T14:55:29Z' },
    ] }); },
  });
  const request = role => new Request('https://test', { method: 'POST',
    headers: { authorization: `Bearer e30.${btoa(JSON.stringify({ role }))}.test`, 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'backfill-official-summaries' }) });
  assert.equal((await handler(request('anon'))).status, 403);
  assert.equal(requests.length, 0);
  const response = await handler(request('service_role'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).repairedCount, 1);
  assert.equal(writes[0].summary, '<p>Official published summary</p>');
  assert.match(requests[0], /\/bill\/119\/hr\/9612\/summaries/);
});

test('repair bounds daily API work and rotates past unpublished bills', async () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({ id: i + 1, bill_type: 'hr',
    number: i + 1, legislation_url: officialBillUrl(119, 'hr', i + 1) }));
  const visited = new Set();
  for (let day = 0; day < 3; day++) {
    const calls = [];
    const client = { from() {
      const q = { select() { return q; }, or() { return q; }, order() { return q; },
        range(from, to) { return Promise.resolve({ data: rows.slice(from, to + 1), error: null }); } };
      return q;
    } };
    const repair = runInNewContext(`${source.slice(start, end)}; backfillMissingOfficialSummaries`, {
      officialBillUrl, console, Date: { now: () => day * 86_400_000 },
      backfillOneBill: async (_client, _key, bill) => {
        calls.push(bill.number); visited.add(bill.number);
        return { changed: false, summaryFound: false };
      },
    });
    const result = await repair(client, 'test');
    assert.ok(calls.length <= 20);
    assert.equal(result.deferredCount, 45 - calls.length);
  }
  assert.equal(visited.size, 45, 'unpublished early measures must not starve later bills');
});
