import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { discoveryScope, publicUrl, campaignUrl } from '../server/src/elections/discoveryUtils.js';
import { fecPages, parseFecPage, fecRace } from '../server/src/elections/sources/fec.js';
import { fetchPublic, isPublicAddress, resolvePublic } from '../server/src/elections/publicHttp.js';
import { verifyCampaignDestination } from '../server/src/elections/verifyCampaignSite.js';

const scope = discoveryScope({states:['WY']});
const fixture = name => readFile(new URL(`./fixtures/elections/discovery/2026-10-26/${name}`,import.meta.url));
const response = (text,status=200,headers={}) => ({bytes:Buffer.from(text),status,headers:{'content-type':'text/html',...headers}});
const resolve = async()=>[{address:'8.8.8.8',family:4}];

test('release scope narrows explicitly and never accepts primary/special imports',()=>{
  assert.deepEqual(discoveryScope({states:['WY','WY']}).states,['WY']);
  for (const value of [{cycle:2028},{stage:'primary'},{contestType:'special'},{states:['DC']},{offices:[]}]) assert.throws(()=>discoveryScope(value));
});
test('all FEC pages are read; partial failures and duplicates do not become success',async()=>{
  const a = JSON.parse((await fixture('fec-wy-house-page-1.json')).toString());
  const b = JSON.parse((await fixture('fec-wy-house-page-2.json')).toString());
  a.pagination = {count:4,page:1,pages:2,per_page:2}; b.pagination = {...a.pagination,page:2};
  const captures=[]; let calls=0;
  const params = {state:'WY',office:'house',apiKey:'fixture-only-secret',capture:async(resp,meta)=>{captures.push(meta.page);return {id:`doc-${meta.page}`};},
    fetcher:async(url,opts)=>{calls++;assert.equal(new URL(url).searchParams.has('api_key'),false);assert.equal(opts.headers['X-Api-Key'],'fixture-only-secret');
      return response(JSON.stringify(new URL(url).searchParams.get('page')==='1' ? a : b));}};
  const rows=[]; for await (const page of fecPages(params)) rows.push(...page.records);
  assert.equal(rows.length,4); assert.equal(calls,2); assert.deepEqual(captures,[1,2]);
  await assert.rejects(async()=>{for await (const ignored of fecPages({...params,maxPages:1})) void ignored;},/page-limit/);
  await assert.rejects(async()=>{for await (const ignored of fecPages({...params,fetcher:async()=>response('{not json')})) void ignored;},/malformed-fec/);
  const duplicate = {...b,results:a.results};
  await assert.rejects(async()=>{for await (const ignored of fecPages({...params,fetcher:async url=>response(JSON.stringify(new URL(url).searchParams.get('page')==='1' ? a : duplicate))})) void ignored;},/pagination-duplicate/);
  assert.throws(()=>parseFecPage(JSON.stringify(a),{state:'AK',office:'house'}),/malformed-fec/);
  const missingName = structuredClone(a); missingName.results[0].name=null;
  const parsed = parseFecPage(JSON.stringify(missingName),{state:'WY',office:'house'});
  assert.equal(parsed.records.length,1); assert.equal(parsed.invalidRecords[0].reason,'missing-name');
  const incomplete=[]; for await (const page of fecPages({...params,fetcher:async url=>response(JSON.stringify(new URL(url).searchParams.get('page')==='1' ? missingName : b))})) incomplete.push(page);
  assert.equal(incomplete.flatMap(page=>page.invalidRecords).length,1);
});
test('public requests pin DNS and bound retries, redirects, and rate-limit waits',async()=>{
  for (const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1']) assert.equal(isPublicAddress(ip),false,ip);
  assert.equal(isPublicAddress('8.8.8.8'),true);
  await assert.rejects(resolvePublic('https://public.example/',async()=>[{address:'127.0.0.1',family:4}]),/private-destination/);
  await assert.rejects(resolvePublic('https://public.example/',()=>new Promise(()=>{}),1),/timeout/);
  assert.throws(()=>publicUrl('http://public.example/'));
  assert.throws(()=>publicUrl('https://user:password@public.example/'));
  assert.equal(campaignUrl('EXAMPLE.COM'),'https://example.com/');
  let requests=0; const options={resolve,allowedOrigins:['https://public.example'],sleep:async()=>{}};
  const good=await fetchPublic('https://public.example/',{...options,request:async(_url,address)=>{
    assert.equal(address.address,'8.8.8.8');return ++requests===1 ? response('',429) : response('ok');}});
  assert.equal(good.bytes.toString(),'ok'); assert.equal(requests,2);
  await assert.rejects(fetchPublic('https://public.example/',{...options,request:async()=>response('',302,{location:'https://evil.example/'})}),/unapproved-redirect/);
  requests=0;
  await assert.rejects(fetchPublic('https://public.example/',{...options,request:async()=>{requests++;return response('',429,{'retry-after':'3600'});}}),/retry-deferred/);
  assert.equal(requests,1);
  requests=0;
  await assert.rejects(fetchPublic('https://public.example/',{...options,request:async()=>{requests++;return response('',503);}}),/source-unavailable/);
  assert.equal(requests,3);
  let hop=0;
  await fetchPublic('https://public.example/',{...options,allowedOrigins:['https://public.example','https://other.example'],headers:{'X-Api-Key':'test-only'},
    request:async(_url,_address,opts)=>{
      if (++hop===1) {assert.equal(opts.headers['X-Api-Key'],'test-only');return response('',302,{location:'https://other.example/'});}
      assert.deepEqual(opts.headers,{});return response('ok');
    }});
});
test('campaign approval requires a supported official link, name/race consistency, and approved redirect',async()=>{
  const data={kind:'fec',fecId:'S6WY99999',committeeId:'C00000001',raw:{candidate_id:'S6WY99999'},name:'Alex Example',race:{office:'senate'},siteUrl:'https://alex.example/',excerpt:'Alex Example https://alex.example/'};
  const observation={id:'obs',record_key:'key',data,validation:{outcome:'valid'},context:{},system:'fec:discovery',final_url:'https://official.example/list'};
  const resolution={candidacy_id:'candidacy'};
  const run=(overrides={},text='Alex Example for U.S. Senate')=>verifyCampaignDestination({observation:{...observation,...overrides},resolution,
    fetcher:async()=>response(text),checkedAt:'2026-10-26T20:00:00Z'});
  const site=await run(); assert.equal(site.status,'verified');assert.ok(site.reviewAfter);assert.equal(site.approvedDestinations[0].origin,'https://alex.example');
  assert.equal((await run({},'Someone Else for Senate')).status,'ambiguous');
  assert.equal((await run({},'<html><head><title>Alex Example for Senate</title></head><body><script>Ignored</script></body></html>')).status,'verified');
  assert.equal((await run({},'<html><head><title>Someone Else</title></head><body><script>Alex Example for Senate</script></body></html>')).status,'ambiguous');
  assert.equal((await run({data:{...data,siteUrl:null}})).status,'missing');
  assert.equal((await run({data:{...data,siteUrl:'https://secure.actblue.com/donate'}})).status,'rejected');
  assert.equal((await run({validation:{outcome:'needs-review'}})).status,'proposed');
});
// FEC discovery does not assert ballot access.
test('FEC-only race mapping supports regular scope without state ballot adapters', async () => {
  const {fecRace} = await import('../server/src/elections/sources/fec.js');
  assert.equal(fecRace({district:'00'},{state:'WY',office:'house'}).district,0);
  assert.equal(fecRace({}, {state:'WY',office:'senate'}).senateSeat,2);
  assert.equal(fecRace({}, {state:'FL',office:'senate'}),null);
  assert.equal(fecRace({district:null}, {state:'NY',office:'house'}),null);
  assert.equal(fecRace({candidate_inactive:true}, {state:'WY',office:'senate'}),null);
});


test('2026 regular Senate race scope matches the official Senate class II snapshot',async()=>{
  const { STATES } = await import('../server/src/elections/contracts.js');
  const html=(await fixture('senate-class-ii.html')).toString();
  const official=new Set([...html.matchAll(/\([DRI]-([A-Z]{2})\)/g)].map(match=>match[1]));
  assert.equal(official.size,33);
  const actual=new Set(STATES.filter(state=>fecRace({}, {state,office:'senate'})?.senateSeat===2));
  assert.deepEqual([...actual].sort(),[...official].sort());
});
