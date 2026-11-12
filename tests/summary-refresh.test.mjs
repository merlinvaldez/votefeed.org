import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

test('daily AI refresh writes from official text, guards source races, and isolates failures', async () => {
  const source = await readFile(new URL('../supabase/functions/_shared/refreshAiSummaries.ts', import.meta.url), 'utf8').catch(() => '');
  assert.ok(source, 'daily AI refresh must exist');
  const rows = [{ id: 1, summary: '<p>Official one</p>' }, { id: 2, summary: '<p>Official two</p>' }];
  const writes = [], guards = [];
  const client = { from() {
    let update;
    const q = { select() { return q; }, not() { return q; }, or() { return q; },
      neq() { return q; }, order() { return q; }, limit() { return q; },
      update(value) { update = value; writes.push(value); return q; },
      eq(key, value) { guards.push([key, value]); return q; },
      then(resolve, reject) { return Promise.resolve({ data: update ? [{ id: 1 }] : rows, error: null }).then(resolve, reject); } };
    return q;
  } };
  const refresh = runInNewContext(stripTypeScriptTypes(source).replace(/^import .*;\r?$/gm, '').replace('export async function', 'async function') + '; refreshAiSummaries', {
    console, generateQuickSummary: async (_key, official) => {
      if (official.includes('two')) throw new Error('upstream unavailable');
      return 'protect people under the new rules';
    },
  });
  const result = await refresh(client, 'test');
  assert.equal(result.generatedCount, 1);
  assert.equal(result.failedCount, 1);
  assert.equal(writes[0].aisummary, 'protect people under the new rules');
  assert.ok(guards.some(([k,v]) => k === 'summary' && v === rows[0].summary));
  assert.equal((await refresh(client, undefined)).generatedCount, 0);
});

test('notification generation uses title-only source before official publication and guards both sources', async () => {
  const source = stripTypeScriptTypes(await readFile(new URL('../supabase/functions/send-vote-notifications/index.ts', import.meta.url), 'utf8'));
  const body = source.slice(source.indexOf('async function generateMissingAiSummaries('), source.indexOf('function buildPreviewDigest('));
  const guards = [], inputs = [];
  const client = { from() {
    const q = { update() { return q; }, eq(k,v) { guards.push([k,v]); return q; }, is(k,v) { guards.push([k,v]); return q; },
      select() { return q; }, then(resolve,reject) { return Promise.resolve({ data: [{id:7}], error: null }).then(resolve,reject); } };
    return q;
  } };
  const run = runInNewContext(body + '; generateMissingAiSummaries', {
    console, Date, MAX_AI_SUMMARIES_PER_INVOCATION: 25, normalizeQuickSummary: value => value ?? '',
    generateQuickSummary: async (...args) => { inputs.push(args); return 'protect student athletes'; }, getErrorMessage: String,
  });
  const bill = { bill_type: 'hr', number: 7, title: 'Protect Student Athletes Act', summary: '', aisummary: null };
  const result = await run(client, new Map([['hr:7', bill]]), 'test');
  assert.equal(result.generatedCount, 1);
  assert.equal(inputs[0][1], bill.title);
  assert.equal(inputs[0][2], 'title');
  assert.ok(guards.some(([k,v]) => k === 'title' && v === bill.title));
  assert.ok(guards.some(([k,v]) => k === 'summary' && v === ''));
});

test('notification AI writer cannot mark a changed official source as refreshed', async () => {
  const source = stripTypeScriptTypes(await readFile(new URL('../supabase/functions/send-vote-notifications/index.ts', import.meta.url), 'utf8'));
  const body = source.slice(source.indexOf('async function generateMissingAiSummaries('), source.indexOf('function buildPreviewDigest('));
  const guards = [];
  const client = { from() {
    const q = { update() { return q; }, eq(k,v) { guards.push([k,v]); return q; },
      select() { return q; }, then(resolve,reject) { return Promise.resolve({ data: [], error: null }).then(resolve,reject); } };
    return q;
  } };
  const run = runInNewContext(body + '; generateMissingAiSummaries', {
    console, MAX_AI_SUMMARIES_PER_INVOCATION: 25, normalizeQuickSummary: value => value ?? '',
    generateQuickSummary: async () => 'old source AI', getErrorMessage: String,
  });
  const bill = { bill_type: 'hr', number: 7, summary: '<p>Original source</p>', aisummary: null };
  const result = await run(client, new Map([['hr:7', bill]]), 'test');
  assert.ok(guards.some(([k,v]) => k === 'summary' && v === bill.summary));
  assert.equal(result.generatedCount, 0);
  assert.equal(bill.aisummary, null);
});
