import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { officialBillUrl } from '../supabase/functions/_shared/billUrl.ts';

// Exercise the deployed ingestion functions with a database/API double, without
// starting Deno.serve or issuing Congress API requests.
const source = stripTypeScriptTypes(await readFile(new URL('../supabase/functions/sync-votes/index.ts', import.meta.url), 'utf8'));
const extract = (start,end) => source.slice(source.indexOf(start),source.indexOf(end));
const functions = extract('async function backfillOneBill(', 'async function runPendingBillBackfill(') +
  extract('async function ensureHouseBillTitles(', 'function buildBillSummaryTargets(');

function fixture(existing) {
  const writes = [];
  const supabase = { from() {
    let data = existing;
    const chain = {
      select() { return chain; }, eq() { return chain; }, in() { return chain; },
      range() { return chain; }, limit() { return chain; },
      update(row) { writes.push(row); data = []; return chain; },
      upsert(row) { writes.push(row); data = []; return chain; },
      then(resolve,reject) { return Promise.resolve({ data,error:null }).then(resolve,reject); },
    };
    return chain;
  } };
  const api = runInNewContext(`${functions}; ({backfillOneBill,ensureHouseBillTitles})`, {
    officialBillUrl, console,
    fetchCongressBillTitle: async () => 'Official title',
    fetchCongressBillSummary: async () => 'Official summary',
  });
  return {api,supabase,writes};
}

test('House ingestion creates official links and repairs links even when title and summary are complete', async () => {
  for (const existing of [[],[{title:'Title',summary:'Summary',legislation_url:null}]]) {
    const {api,supabase,writes} = fixture(existing);
    await api.backfillOneBill(supabase,'test',{congress:119,billType:'hr',number:7});
    assert.equal(writes[0].legislation_url, officialBillUrl(119,'hr',7));
  }
  const {api,supabase,writes} = fixture([]);
  await api.ensureHouseBillTitles(supabase,'test',[{legislationType:'hr',legislationNumber:7}]);
  assert.equal(writes[0][0].legislation_url, officialBillUrl(119,'hr',7));
});

test('House metadata refresh preserves an existing official URL', async () => {
  const {api,supabase,writes} = fixture([{title:'Title',summary:'Summary',legislation_url:officialBillUrl(119,'hr',7)}]);
  await api.backfillOneBill(supabase,'test',{congress:119,billType:'hr',number:7});
  assert.equal(writes.length,0);
});
