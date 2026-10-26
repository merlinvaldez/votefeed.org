import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sha256, discoveryScope, stableJson } from '../server/src/elections/discoveryUtils.js';
import { validateBallotRows } from '../server/src/elections/ballotExtraction.js';
import { STATES } from '../server/src/elections/contracts.js';

// Offline evidence check. Never imports DB clients or calls a model/network.
const root=new URL('../',import.meta.url),fixture=new URL('tests/fixtures/elections/onboarding/2026-10-26/',root);
const json=async url=>JSON.parse(await readFile(url,'utf8'));
const catalog=await json(new URL('specs/elections-source-proposals.json',root));
assert.deepEqual(catalog.states.map(s=>s.state).sort(),[...STATES].sort());
assert.equal(catalog.authoritative,false);assert.equal(catalog.databaseWrites,false);
for(const state of catalog.states) for(const proposal of state.sources) {
  assert.equal(new URL(proposal.url).origin,new URL(state.authorityUrl).origin);
  assert.equal(proposal.status,'proposed');
}
const report=await json(new URL('line-reader/report.json',fixture));
const expected=await json(new URL('expected-federal-rows.json',fixture));
let valid=0;
for(const source of report.sources) {
  const bytes=await readFile(new URL(`line-reader/${source.archive}`,fixture));
  assert.equal(sha256(bytes),source.sha256);
  const text=await readFile(new URL(`line-reader/${source.textFile}`,fixture),'utf8');
  assert.equal(sha256(await readFile(new URL(`${source.state}.raw`,fixture))),source.sha256);
  if(source.state==='ND') {assert.equal(source.records.length,0);assert.equal(source.status,'needs-review');continue;}
  const records=source.records.map(r=>r.data);
  const wanted=expected.states[source.state];assert.equal(records.length,wanted.length);
  for(const row of wanted) {
    const actual=records.filter(r=>r.name===row.name);assert.equal(actual.length,1,row.name);
    for(const key of ['party','eligibility','siteUrl']) assert.equal(actual[0][key],row[key],`${row.name}:${key}`);
    assert.equal(actual[0].fecId,null);assert.equal(actual[0].officialId,null);
    assert.equal(stableJson(actual[0].race),stableJson(source.source.races.find(r=>r.label===row.raceLabel).race));
    assert.ok(text.includes(actual[0].excerpt));
  }
  // Re-run code validation; the saved independent model decision remains a
  // historical artifact, rather than being simulated as a new live check.
  const checks=source.records.map(r=>({locator:r.data.locator,supported:r.validation.outcome==='valid'}));
  assert.ok(validateBallotRows(records,text,source.source,discoveryScope({states:[source.state]}),checks).every(r=>r.validation.outcome==='valid'));
  valid+=records.length;
}
assert.equal(valid,54);
const csv=await json(new URL('mapped-csv/report.json',fixture));
assert.equal(csv.sources[0].valid,6);
assert.equal(sha256(await readFile(new URL(`mapped-csv/${csv.sources[0].archive}`,fixture))),csv.sources[0].sha256);
console.log(JSON.stringify({statesSearched:catalog.states.length,statesWithProposals:catalog.states.filter(s=>s.status==='proposed').length,
  validNewStateRows:valid,validMappedCsvRows:6,blockedState:'ND',status:'partial',databaseWrites:false},null,2));
