import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchSourceCatalog, inspectSourceBatch, onboardingCoverage } from '../server/src/elections/sourceOnboarding.js';
import { createOpenAiDiscoveryProvider } from '../server/src/elections/openaiDiscoveryProvider.js';
import { discoveryScope, sha256 } from '../server/src/elections/discoveryUtils.js';
import { extractMappedCsv, validateBallotRows } from '../server/src/elections/ballotExtraction.js';
import { wyomingSource } from '../server/src/elections/sources/wyoming.js';

const inventory={states:['DE','ND','WY'].map(state=>({state,authorityDirectoryUrl:`https://${state.toLowerCase()}.example/`}))};
const scope=discoveryScope({states:['DE','ND','WY']});
async function temporary(fn) {const dir=await mkdtemp(join(tmpdir(),'election-onboarding-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}

test('search checkpoints isolate failures, filter off-authority URLs and resume only gaps',()=>temporary(async dir=>{
  const checkpoint=join(dir,'catalog.json'),calls=[];
  const provider={model:'fixture',search:async({state})=>{
    calls.push(state);
    // Confirm previous state is already durable when the next search starts.
    if(state==='ND') {assert.equal(JSON.parse(await readFile(checkpoint)).states[0].state,'DE');throw new Error('private provider details');}
    return [{url:`https://${state.toLowerCase()}.example/list`,title:'official'},{url:'https://other.example/list'}];
  }};
  const first=await searchSourceCatalog({scope,inventory,provider,checkpoint});
  assert.deepEqual(first.states.map(s=>s.status),['proposed','failed','proposed']);
  assert.equal(first.states[0].sources.length,1);assert.equal(first.authoritative,false);
  assert.equal(first.states[1].errorCode,'discovery-operation-failed');
  calls.length=0;provider.search=async({state})=>{calls.push(state);return [];};
  const second=await searchSourceCatalog({scope,inventory,provider,checkpoint,resume:true});
  assert.deepEqual(calls,['ND']);assert.equal(second.states[1].status,'no-results');assert.equal(second.states[1].attempts,2);
  await assert.rejects(searchSourceCatalog({scope:discoveryScope({states:['DE']}),inventory,provider,checkpoint,resume:true}),/scope-mismatch/);
  await assert.rejects(searchSourceCatalog({scope,inventory,provider,checkpoint}),/checkpoint-exists/);
  await writeFile(`${checkpoint}.lock`,'');
  await assert.rejects(searchSourceCatalog({scope,inventory,provider,checkpoint,resume:true}),/checkpoint-locked/);
}));

test('concurrent search saves all results without clobbering the checkpoint',()=>temporary(async dir=>{
  let active=0,peak=0;
  const provider={model:'fixture',search:async({state})=>{active++;peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,state==='DE'?20:5));active--;return [{url:`https://${state.toLowerCase()}.example/list`}];}};
  const checkpoint=join(dir,'catalog.json');
  await searchSourceCatalog({scope,inventory,provider,checkpoint,concurrency:3});
  assert.equal(peak,3);assert.equal(JSON.parse(await readFile(checkpoint)).states.length,3);
}));

test('inspection archives bytes before parser failure, continues and never marks empty output complete',()=>temporary(async dir=>{
  const sources=[{...wyomingSource,id:'bad',url:'https://sos.wyo.gov/bad',format:'ai'},wyomingSource];
  const bytes=await readFile(new URL('./fixtures/elections/discovery/2026-10-26/wy-general-candidates.csv',import.meta.url));
  const report=await inspectSourceBatch({scope:discoveryScope({states:['WY','DE']}),sources,archiveDirectory:dir,
    fetcher:async url=>({bytes:url.endsWith('/bad')?Buffer.from('not a supported format'):bytes,
      headers:{'content-type':url.endsWith('/bad')?'application/unknown':'text/csv'},finalUrl:url,retrievedAt:'2026-10-26T00:00:00Z'})});
  assert.equal(report.sources[0].status,'failed');assert.equal(report.sources[1].valid,6);
  assert.equal(await readFile(join(dir,report.sources[0].archive),'utf8'),'not a supported format');
  assert.equal(report.sources[1].sha256,sha256(bytes));assert.equal(report.databaseWrites,false);
  assert.ok(report.coverage.every(c=>c.status!=='complete'));
  assert.equal(report.coverage.find(c=>c.state==='DE').status,'unsupported');
  const resumed=await inspectSourceBatch({scope:discoveryScope({states:['WY','DE']}),sources,archiveDirectory:dir,resume:true,
    fetcher:async()=>{throw new Error('unavailable');}});
  assert.equal(resumed.sources.find(s=>s.sourceId===wyomingSource.id).valid,6);
  assert.equal(resumed.sources.find(s=>s.sourceId==='bad').previousAttempts.length,1);
  const coverage=onboardingCoverage({scope:discoveryScope({states:['WY','DE']}),inventory,sources,inspection:resumed});
  assert.equal(coverage.states.find(s=>s.state==='WY').offices[0].status,'partial');
  assert.equal(coverage.states.find(s=>s.state==='DE').offices[0].status,'unsupported');
}));

test('reviewed CSV mapping handles quoted values, excludes primaries, and preserves unknown statuses for review',()=>{
  const source={...wyomingSource,format:'mapped-csv',csv:{filter:{column:'Election',value:'2026 general'},
    columns:{name:'Name',office:'Office',party:'Party',website:'Website',status:'Status'},
    statuses:{Qualified:'ballot-confirmed',Withdrawn:'withdrawn'}}};
  const text='Election,Office,Name,Party,Website,Status\n2026 primary,UNITED STATES REPRESENTATIVE,Wrong,REP,,Qualified\n2026 general,UNITED STATES REPRESENTATIVE,"Alex, Example",REP,alex.example,Qualified\n2026 general,UNITED STATES REPRESENTATIVE,Other,DEM,,Pending\n';
  const scope=discoveryScope({states:['WY']});
  const rows=extractMappedCsv(text,source,scope),records=validateBallotRows(rows,text,source,scope);
  assert.equal(rows.length,2);assert.equal(rows[0].name,'Alex, Example');assert.equal(records[0].validation.outcome,'valid');
  assert.equal(records[1].validation.outcome,'needs-review');
  assert.throws(()=>extractMappedCsv(text.replace('Website','Bad column'),source,scope),/malformed-csv/);
});

test('AI selects numbered evidence lines; server copies exact whitespace and rejects invalid ranges',async()=>{
  const provider=createOpenAiDiscoveryProvider({model:'fixture',client:{responses:{create:async args=>{
    assert.deepEqual(JSON.parse(args.input).lines,[{line:1,text:'PARTY'},{line:2,text:'Name\t District'},{line:3,text:'tail'}]);
    return {status:'completed',output_text:JSON.stringify({items:[
      {name:'Name',evidenceStartLine:1,evidenceEndLine:2},
      {name:'Other',evidenceStartLine:0,evidenceEndLine:99},
    ]})};
  }}}});
  const rows=await provider.extract({source:wyomingSource,text:'PARTY\nName\t District\ntail'});
  assert.equal(rows[0].excerpt,'PARTY\nName\t District');assert.equal(rows[1].excerpt,'');
});
