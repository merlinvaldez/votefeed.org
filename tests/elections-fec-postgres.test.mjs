import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from '../server/node_modules/pg/lib/index.js';
import { syncCandidates } from '../server/src/elections/syncCandidates.js';

test('FEC discovery persists verified sites and is repeatable', {skip:process.env.ELECTIONS_TEST_POSTGRES!=='1'}, async () => {
  const config={host:'127.0.0.1',port:55439,user:'postgres',database:'postgres',ssl:false};
  const admin=new pg.Client(config); await admin.connect();
  const database=`fec_${randomUUID().replaceAll('-','')}`; let pool;
  try {
    await admin.query(`CREATE DATABASE ${database}`); pool=new pg.Pool({...config,database});
    for (const role of ['anon','authenticated','service_role']) await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
    await pool.query('CREATE TABLE users(id serial PRIMARY KEY,clerk_user_id text UNIQUE); CREATE TABLE reps(bioguideid text PRIMARY KEY); CREATE TABLE bills(id serial PRIMARY KEY,title text)');
    for (const name of ['20261026194547_elections_storage.sql','20261026203305_election_discovery_observations.sql']) await pool.query(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
    const candidate={candidate_id:'H6WY00001',name:'EXAMPLE, ALEX',state:'WY',office:'H',district:'00',election_years:[2026],candidate_inactive:false};
    const committee={committee_id:'C00000001',candidate_ids:[candidate.candidate_id],designation:'P',website:'https://alex.example/'};
    const fetcher=async url=>{const site=url.startsWith('https://alex.example'); const data=site?'Alex Example for Congress':JSON.stringify({pagination:{page:1,pages:1,count:1,per_page:100},results:[url.includes('/committees/')?committee:candidate]}); return {bytes:Buffer.from(data),requestedUrl:url,finalUrl:url,retrievedAt:'2026-10-26T20:00:00Z',headers:{'content-type':site?'text/html':'application/json'}};};
    const run=()=>syncCandidates({scope:{states:['WY'],offices:['house']},fecApiKey:'fixture',fecIntervalMs:0,verifySites:true,fetcher,pool});
    const first=await run(); assert.equal(first.status,'complete'); assert.equal(first.counts.sitesVerified,1);
    const before=(await pool.query('SELECT count(*)::int n FROM campaign_sites')).rows[0].n;
    const second=await run(); assert.equal(second.status,'complete');
    assert.equal((await pool.query('SELECT count(*)::int n FROM election_candidates')).rows[0].n,1);
    assert.equal((await pool.query('SELECT count(*)::int n FROM campaign_sites')).rows[0].n,before);
    assert.equal((await pool.query('SELECT status FROM campaign_sites WHERE is_current')).rows[0].status,'verified');
    const malformedFetcher=async url=>{
      const result=await fetcher(url);
      if(url.includes('/H6WY00002/committees/')) {
        const body=JSON.parse(result.bytes.toString()); body.results[0].candidate_ids=['H6WY00002']; body.results[0].website='https://unknown-candidate.example/'; result.bytes=Buffer.from(JSON.stringify(body));
      } else if(!url.includes('/committees/') && !url.startsWith('https://alex.example')) {
        const body=JSON.parse(result.bytes.toString()); body.results.push({...candidate,candidate_id:'H6WY00002',name:null,district:null}); body.pagination.count=2;
        result.bytes=Buffer.from(JSON.stringify(body));
      }
      return result;
    };
    const partial=await syncCandidates({scope:{states:['WY'],offices:['house']},fecApiKey:'fixture',fecIntervalMs:0,fetcher:malformedFetcher,pool});
    assert.equal(partial.status,'partial'); assert.ok(partial.errorCodes.includes('discovery-fec-invalid-record'));
    assert.equal(partial.counts.unresolved,2); assert.equal((await pool.query('SELECT count(*)::int n FROM election_candidates')).rows[0].n,1);
    assert.equal((await pool.query("SELECT count(*)::int n FROM election_discovery_observations WHERE validation->>'outcome'='invalid'")).rows[0].n,2);
    const pending=(await pool.query("SELECT data->>'siteUrl' AS url FROM election_discovery_observations WHERE validation->>'outcome'='invalid' AND data->>'siteUrl' IS NOT NULL")).rows;
    assert.equal(pending[0].url,'https://unknown-candidate.example/');
    assert.equal((await pool.query("SELECT count(*)::int n FROM campaign_sites WHERE proposed_url='https://unknown-candidate.example/'")).rows[0].n,0);
    let requests=0;
    const limitedFetcher=async url=>{requests++;if(url.includes('/committees/')) throw Object.assign(new Error('rate limit'),{code:'discovery-rate-limited'});return fetcher(url);};
    const limited=await syncCandidates({scope:{states:['WY'],offices:['house','senate']},fecApiKey:'fixture',fecIntervalMs:0,fetcher:limitedFetcher,pool});
    assert.equal(requests,2); assert.equal(limited.status,'partial');
    assert.equal(limited.coverage.find(entry=>entry.office==='senate').status,'failed');
    assert.ok(limited.errorCodes.includes('discovery-rate-limited'));
    let committeeRequests=0;
    const inactiveFetcher=async url=>{const result=await fetcher(url);if(url.includes('/committees/')) committeeRequests++;else if(!url.startsWith('https://alex.example')){const body=JSON.parse(result.bytes.toString());body.results.push({...candidate,candidate_id:'H6WY00003',candidate_inactive:true});body.pagination.count=2;result.bytes=Buffer.from(JSON.stringify(body));}return result;};
    const inactive=await syncCandidates({scope:{states:['WY'],offices:['house']},fecApiKey:'fixture',fecIntervalMs:0,fetcher:inactiveFetcher,pool});
    assert.equal(inactive.status,'complete');assert.equal(committeeRequests,1);



  } finally {if(pool) await pool.end(); await admin.query(`DROP DATABASE IF EXISTS ${database}`); await admin.end();}
});
