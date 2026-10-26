import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from '../server/node_modules/pg/lib/index.js';
import { syncCandidates } from '../server/src/elections/syncCandidates.js';
import * as discovery from '../server/src/db/queries/electionDiscovery.js';
import { wyomingSource as source } from '../server/src/elections/sources/wyoming.js';
import { discoveryScope } from '../server/src/elections/discoveryUtils.js';

const fixture = name=>readFile(new URL(`./fixtures/elections/discovery/2026-10-26/${name}`,import.meta.url));
test('discovery migration and complete worker flow on disposable PostgreSQL', {skip:process.env.ELECTIONS_TEST_POSTGRES!=='1'},async t=>{
  const config={host:'127.0.0.1',port:55439,user:'postgres',database:'postgres',ssl:false};
  const admin=new pg.Client(config);await admin.connect();
  const database=`discovery_${randomUUID().replaceAll('-','')}`;
  let pool;
  try {
    await admin.query(`CREATE DATABASE ${database}`);pool=new pg.Pool({...config,database});
    for (const role of ['anon','authenticated','service_role']) await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
    await pool.query(`CREATE TABLE users(id serial PRIMARY KEY,clerk_user_id text UNIQUE); CREATE TABLE reps(bioguideid text PRIMARY KEY);
      CREATE TABLE bills(id serial PRIMARY KEY,title text); INSERT INTO bills VALUES(1,'Existing legislation');`);
    for (const name of ['20261026194547_elections_storage.sql','20261026203305_election_discovery_observations.sql']) {
      await pool.query(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
    }
    const csv=await fixture('wy-general-candidates.csv');
    const scope=discoveryScope({states:['WY']});
    const fetcher=async url=>({requestedUrl:url,finalUrl:url,retrievedAt:'2026-10-26T20:00:00Z',headers:{'content-type':'text/csv'},bytes:csv});
    const run=extra=>syncCandidates({scope,sources:[source],includeFec:false,fetcher,pool,...extra});
    const count=async table=>(await pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n;
    let first, ballot;
    await t.test('real state-only rows become candidacies without invented official identities',async()=>{
      first=await run();
      assert.equal(first.status,'partial');assert.equal(first.counts.promoted,6);
      assert.equal(await count('election_candidates'),6);assert.equal(await count('election_candidacies'),6);
      assert.equal(await count('election_candidate_identities'),0);
      assert.equal(await count('election_source_documents'),2);
      assert.equal((await pool.query("SELECT count(*)::int n FROM election_candidacies WHERE eligibility='ballot-confirmed'")).rows[0].n,6);
      assert.equal((await pool.query("SELECT count(*)::int n FROM campaign_sites WHERE status='missing'")).rows[0].n,1);
      const races=(await pool.query('SELECT * FROM election_races')).rows;
      assert.ok(races.some(r=>r.office==='house' && r.district===0));assert.ok(races.some(r=>r.office==='senate' && r.senate_seat===2));
      ballot=(await pool.query("SELECT * FROM election_discovery_observations WHERE data->>'name'='Harriet Hageman'")).rows[0];
      assert.equal((await pool.query('SELECT title FROM bills WHERE id=1')).rows[0].title,'Existing legislation');
    });
    await t.test('repeat runs preserve candidates, documents, original dates, and site revisions',async()=>{
      const attempts=await count('election_discovery_attempts');
      await run();
      assert.equal(await count('election_candidates'),6);assert.equal(await count('election_source_documents'),2);
      assert.equal(await count('election_discovery_observations'),6);assert.equal(await count('campaign_sites'),6);
      assert.equal(await count('election_discovery_attempts'),attempts+1);
      assert.equal(new Date((await pool.query('SELECT retrieved_at FROM election_source_documents LIMIT 1')).rows[0].retrieved_at).toISOString(),'2026-10-26T20:00:00.000Z');
      await assert.rejects(pool.query("UPDATE election_source_documents SET source_text='changed'"),/immutable/);
      await assert.rejects(pool.query('DELETE FROM election_discovery_observations'),/immutable/);
    });
    await t.test('site verification persists approvals idempotently and ordinary refreshes retain them',async()=>{
      const rows=(await pool.query("SELECT data FROM election_discovery_observations WHERE data->>'kind'='ballot'")).rows.map(r=>r.data);
      const pages=async url=>{
        if (url===source.url) return fetcher(url);
        const row=rows.find(r=>r.siteUrl===url);assert.ok(row);
        return {requestedUrl:url,finalUrl:url,retrievedAt:'2026-10-26T20:00:00Z',headers:{'content-type':'text/html'},
          bytes:Buffer.from(`<p>${row.name} for ${row.race.office==='senate' ? 'Senate' : 'Congress'}</p>`)};
      };
      await run({verifySites:true,fetcher:pages});
      assert.equal((await pool.query("SELECT count(*)::int n FROM campaign_sites WHERE is_current AND status='verified'")).rows[0].n,5);
      const revisions=await count('campaign_sites');
      await run({verifySites:true,fetcher:pages});await run();
      assert.equal(await count('campaign_sites'),revisions);
      await run({verifySites:true,fetcher:async url=>{
        if (url===source.url) return fetcher(url);
        throw Object.assign(new Error('network unavailable'),{code:'discovery-timeout'});
      }});
      assert.equal(await count('campaign_sites'),revisions);
    });
    await t.test('FEC worker creates candidacies with unknown eligibility and attaches identities',async()=>{
      const fecFetcher=async(url,options)=>{
        if (!url.includes('api.open.fec.gov')) return fetcher(url);
        assert.equal(options.headers['X-Api-Key'],'fixture-only-secret');
        const bytes=await fixture(new URL(url).searchParams.get('office')==='H' ? 'fec-wy-house-complete.json' : 'fec-wy-senate.json');
        return {requestedUrl:url,finalUrl:url,retrievedAt:'2026-10-26T20:00:00Z',headers:{'content-type':'application/json'},bytes};
      };
      const result=await run({includeFec:true,fecApiKey:'fixture-only-secret',maxCommittees:0,fetcher:fecFetcher});
      assert.equal(await count('election_candidates'),29);assert.equal(result.counts.promoted,29);
      assert.equal((await pool.query("SELECT count(*)::int n FROM election_discovery_observations WHERE data->>'kind'='fec'")).rows[0].n,23);
      assert.equal((await pool.query("SELECT count(*)::int n FROM election_source_documents WHERE source_text LIKE '%fixture-only-secret%'")).rows[0].n,0);
      assert.ok(result.coverage.every(c=>c.fecStatus==='partial')); // Explicit committee cap.
      assert.equal((await pool.query("SELECT count(*)::int n FROM election_candidate_identities WHERE system='fec:candidate'")).rows[0].n,23);
      assert.equal((await pool.query("SELECT count(*)::int n FROM election_candidacies WHERE eligibility='unknown'")).rows[0].n,22);
      const fec=(await pool.query("SELECT id FROM election_discovery_observations WHERE data->>'fecId'='S6WY00209'")).rows[0];
      const person=(await pool.query('SELECT candidate_id FROM election_observation_resolutions WHERE observation_id=$1',[ballot.id])).rows[0].candidate_id;
      await assert.rejects(discovery.promoteElectionObservation(fec.id,{candidateId:person},pool),/evidence-required/);
      await assert.rejects(discovery.promoteElectionObservation(fec.id,{candidateId:person,actor:'fixture-reviewer',review:{url:source.url,reason:'Controlled explicit cross-reference fixture'}},pool),/resolution-conflict/);
      assert.ok((await pool.query("SELECT candidate_id FROM election_candidate_identities WHERE source_id='S6WY00209'")).rows[0].candidate_id);
      assert.equal(await count('election_candidates'),29);
    });
    await t.test('FEC-only worker creates candidacies idempotently without ballot claims',async()=>{
      const raw={candidate_id:'S6WY00999',name:'FEC Fixture Person',state:'WY',office:'S',election_years:[2026],candidate_status:'C',candidate_inactive:false};
      const fetchFec=async url=>({requestedUrl:url,finalUrl:url,retrievedAt:'2026-10-26T20:00:00Z',headers:{'content-type':'application/json'},
        bytes:Buffer.from(JSON.stringify({pagination:{page:1,pages:1,count:1,per_page:100},results:[raw]}))});
      const options={scope:discoveryScope({states:['WY'],offices:['senate']}),sources:[],includeFec:true,fecApiKey:'fixture',maxCommittees:0,fetcher:fetchFec,pool};
      const before=await count('election_candidacies');
      const first=await syncCandidates(options);
      assert.equal(first.counts.promoted,1);
      assert.equal(await count('election_candidacies'),before+1);
      await syncCandidates(options);
      assert.equal(await count('election_candidacies'),before+1);
      const row=(await pool.query("SELECT co.* FROM election_candidacies co JOIN election_candidate_identities fi ON fi.candidate_id=co.candidate_id WHERE fi.source_id=$1",[raw.candidate_id])).rows[0];
      assert.equal(row.eligibility,'unknown');
      assert.equal(first.coverage[0].status,'unsupported');
    });
    await t.test('changed ambiguous rows require resolution; explicit withdrawal wins over older/ordinary lists',async()=>{
      const original=await discovery.readDiscoveryObservation(ballot.id,pool);
      const person=(await pool.query('SELECT candidate_id FROM election_observation_resolutions WHERE observation_id=$1',[ballot.id])).rows[0].candidate_id;
      const save=async({date='2026-10-28T00:00:00Z',effectiveAt=date,eligibility='withdrawn',name=original.data.name}={})=>{
        const text=`${name}: ${eligibility} as of ${effectiveAt}`;
        const doc=await discovery.saveElectionDocument({sourceKey:source.id,system:'state:WY:ballot',requestedUrl:source.url,finalUrl:source.url,
          retrievedAt:date,effectiveAt,bytes:Buffer.from(text),text,mediaType:'text/plain',context:{authoritative:true,source,scope}},pool);
        const [obs]=await discovery.saveElectionExtraction({documentId:doc.id,extractor:'controlled-fixture',promptVersion:'none',outcome:'valid',
          records:[{data:{...original.data,name,eligibility,excerpt:text,raw:{changed:true,effectiveAt}},validation:{outcome:'valid',errors:[],validatorVersion:'fixture'}}]},pool);
        return obs;
      };
      const withdrawal=await save();
      await assert.rejects(discovery.promoteElectionObservation(withdrawal.id,{},pool),/match-review-required/);
      await discovery.promoteElectionObservation(withdrawal.id,{candidateId:person,actor:'reviewer',review:{url:source.url,reason:'Explicit identity resolution with dated withdrawal evidence'}},pool);
      const eligibility=async()=>(await pool.query('SELECT eligibility FROM election_candidacies WHERE candidate_id=$1',[person])).rows[0].eligibility;
      assert.equal(await eligibility(),'withdrawn');
      const stale=await save({date:'2026-10-30T00:00:00Z',effectiveAt:'2026-10-27T00:00:00Z',eligibility:'ballot-confirmed'});
      await discovery.promoteElectionObservation(stale.id,{candidateId:person,actor:'reviewer',review:{url:source.url,reason:'Older source fetched later'}},pool);
      assert.equal(await eligibility(),'withdrawn');
      const ordinary=await save({date:'2026-11-01T00:00:00Z',eligibility:'ballot-confirmed'});
      await discovery.promoteElectionObservation(ordinary.id,{candidateId:person,actor:'reviewer',review:{url:source.url,reason:'Ordinary listing is not reinstatement'}},pool);
      assert.equal(await eligibility(),'withdrawn');
      assert.equal(await count('election_candidates'),30);
    });
    await t.test('partial/failed sources do not remove prior candidacies or claim complete coverage',async()=>{
      const failed=await run({fetcher:async()=>{throw Object.assign(new Error('sensitive provider error'),{code:'discovery-timeout'});}});
      assert.equal(failed.status,'failed');assert.equal(await count('election_candidacies'),29);
      const nationwide=await run({scope:discoveryScope({states:['WY','AK']})});
      assert.equal(nationwide.status,'partial');assert.ok(nationwide.coverage.filter(e=>e.state==='AK').every(e=>e.status==='unsupported'));
      assert.ok(!JSON.stringify(failed).includes('sensitive'));
    });
    await t.test('browser roles cannot access raw source, observation, or resolution data',async()=>{
      const c=await pool.connect();
      try {
        for (const role of ['anon','authenticated']) {
          await c.query(`SET ROLE ${role}`);
          for (const table of ['election_source_documents','election_discovery_observations','election_discovery_attempts','election_observation_resolutions']) {
            await assert.rejects(c.query(`SELECT * FROM ${table}`),error=>error.code==='42501');
            await assert.rejects(c.query(`INSERT INTO ${table} DEFAULT VALUES`),error=>error.code==='42501');
          }
          await c.query('RESET ROLE');
        }
      } finally {await c.query('RESET ROLE');c.release();}
    });
    await t.test('invalid observation promotion rolls back its candidate and identity',async()=>{
      const doc=await discovery.saveElectionDocument({sourceKey:'bad',system:'state:WY:ballot',requestedUrl:source.url,finalUrl:source.url,
        retrievedAt:'2026-10-26T00:00:00Z',bytes:Buffer.from('bad'),text:'bad',mediaType:'text/plain',context:{authoritative:false}},pool);
      const [obs]=await discovery.saveElectionExtraction({documentId:doc.id,extractor:'fixture',promptVersion:'none',outcome:'valid',records:[{
        data:{kind:'ballot',name:'Rollback Person',party:null,officialId:'rollback',fecId:null,race:source.races[0].race,eligibility:'ballot-confirmed'},
        validation:{outcome:'valid',errors:[],validatorVersion:'fixture'},
      }]},pool);
      const before=await count('election_candidates');
      await assert.rejects(discovery.promoteElectionObservation(obs.id,{},pool),/untrusted-ballot/);
      assert.equal(await count('election_candidates'),before);
      assert.equal((await pool.query("SELECT count(*)::int n FROM election_candidate_identities WHERE source_id='rollback'")).rows[0].n,0);
    });
    await t.test('AI verification retry records a new decision without rewriting the earlier observation',async()=>{
      const aiSource={...source,id:'ai-fixture',format:'ai',races:[source.races[0]]};
      const text='2026 GENERAL ELECTION UNITED STATES REPRESENTATIVE AI Fixture Person REP';
      const row={name:'AI Fixture Person',party:'REP',raceLabel:aiSource.races[0].label,officialId:null,fecId:null,website:null,
        eligibility:'ballot-confirmed',excerpt:text,locator:'fixture-row'};
      let supported=false;
      const provider={model:'fixture',promptVersion:'ballot-v1',extract:async()=>[row],verify:async()=>[{locator:row.locator,supported}]};
      const options={sources:[aiSource],provider,fetcher:async url=>({requestedUrl:url,finalUrl:url,retrievedAt:'2026-10-26T20:00:00Z',headers:{'content-type':'text/plain'},bytes:Buffer.from(text)})};
      const before=await count('election_candidates');
      const first=await run(options);assert.equal(first.counts.promoted,0);assert.equal(first.counts.unresolved,1);
      supported=true;
      const accepted=await run(options);assert.equal(accepted.counts.promoted,1);assert.equal(await count('election_candidates'),before+1);
      const decisions=(await pool.query("SELECT validation->>'outcome' outcome FROM election_discovery_observations WHERE data->>'name'='AI Fixture Person'")).rows;
      assert.deepEqual(decisions.map(d=>d.outcome).sort(),['needs-review','valid']);
      await run(options);assert.equal(await count('election_candidates'),before+1);
    });
    await t.test('only an explicit reviewed official no-race proof can establish a complete empty office',async()=>{
      const text='2026 GENERAL ELECTION: No regular U.S. Senate contest is scheduled in this controlled fixture.';
      const noRaceSource={...source,id:'no-race-fixture',format:'ai',races:[],completeness:'complete',coverageAccepted:true,correctionsAudited:true,
        noRaces:[{office:'senate',excerpt:text,reviewedBy:'fixture-reviewer',checkedAt:'2026-10-26T00:00:00Z'}]};
      const result=await run({scope:discoveryScope({states:['WY'],offices:['senate']}),sources:[noRaceSource],
        fetcher:async url=>({requestedUrl:url,finalUrl:url,retrievedAt:'2026-10-26T00:00:00Z',headers:{'content-type':'text/plain'},bytes:Buffer.from(text)})});
      assert.equal(result.status,'complete');assert.equal(result.coverage[0].noRaces,true);
      const unknown=await run({scope:discoveryScope({states:['WY'],offices:['senate']}),sources:[{...noRaceSource,noRaces:[{...noRaceSource.noRaces[0],excerpt:'Absent proof'}]}],
        fetcher:async url=>({requestedUrl:url,finalUrl:url,retrievedAt:'2026-10-26T00:00:00Z',headers:{'content-type':'text/plain'},bytes:Buffer.from(text)})});
      assert.equal(unknown.status,'partial');assert.equal(unknown.coverage[0].noRaces,undefined);
    });
    await t.test('a reviewed distinct person can resolve a same-name collision without moving earlier history',async()=>{
      const original=await discovery.readDiscoveryObservation(ballot.id,pool);
      const doc=await discovery.saveElectionDocument({sourceKey:'distinct-person-fixture',system:'state:WY:ballot',requestedUrl:source.url,finalUrl:source.url,
        retrievedAt:'2026-10-26T00:00:00Z',bytes:Buffer.from('distinct person evidence'),text:'distinct person evidence',mediaType:'text/plain',context:{authoritative:true}},pool);
      const [obs]=await discovery.saveElectionExtraction({documentId:doc.id,extractor:'fixture',promptVersion:'none',outcome:'valid',records:[{
        data:{...original.data,locator:'distinct-person-fixture',raw:{distinct:true}},validation:{outcome:'valid',errors:[],validatorVersion:'fixture'},
      }]},pool);
      await assert.rejects(discovery.promoteElectionObservation(obs.id,{},pool),/match-review-required/);
      await assert.rejects(discovery.promoteElectionObservation(obs.id,{newPerson:true},pool),/evidence-required/);
      const resolved=await discovery.promoteElectionObservation(obs.id,{newPerson:true,actor:'fixture-reviewer',
        review:{url:source.url,reason:'Controlled evidence establishes two distinct people sharing a name'}},pool);
      const earlier=(await pool.query('SELECT candidate_id FROM election_observation_resolutions WHERE observation_id=$1',[ballot.id])).rows[0];
      assert.notEqual(resolved.candidate_id,earlier.candidate_id);
      assert.equal(resolved.method,'reviewed-evidence');
    });
  } finally {
    if(pool) await pool.end(); await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);await admin.end();
  }
});
