import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import express from '../server/node_modules/express/index.js';
import pg from '../server/node_modules/pg/lib/index.js';
import db from '../server/src/db/client.js';
import * as elections from '../server/src/db/queries/elections.js';
import electionsRouter from '../server/src/api/elections.js';
import { readElectionPositionsForAddress } from '../server/src/elections/electionGeography.js';
import { ELECTION_GEOGRAPHY_SOURCE, ELECTION_GEOGRAPHY_VERSION, RELEASE_SCOPE } from '../server/src/elections/contracts.js';

test('elections additive migration and server persistence on disposable PostgreSQL', {skip:process.env.ELECTIONS_TEST_POSTGRES!=='1'}, async t => {
  // A separate database runs the EXACT migration, including public schema, roles,
  // RLS and triggers. Never use DATABASE_URL or a linked Supabase project here.
  const config={host:'127.0.0.1',port:55439,user:'postgres',database:'postgres',ssl:false};
  const admin=new pg.Client(config); await admin.connect();
  const database=`elections_${randomUUID().replaceAll('-','')}`;
  let pool;
  try {
    await admin.query(`CREATE DATABASE ${database}`);
    pool=new pg.Pool({...config,database});
    for (const role of ['anon','authenticated','service_role']) {
      await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
    }
    // Mirror Supabase's public-schema defaults so table migrations must revoke
    // browser and service-role privileges explicitly before granting their contract.
    await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO PUBLIC, anon, authenticated, service_role`);
    await pool.query(`CREATE TABLE users(id serial PRIMARY KEY,clerk_user_id text UNIQUE);
      CREATE TABLE reps(bioguideid text PRIMARY KEY,image_url text,is_current_member boolean NOT NULL DEFAULT true);
      CREATE TABLE bills(id serial PRIMARY KEY,number integer,bill_type text);
      CREATE TABLE interactions(id serial PRIMARY KEY,user_id integer,bill_id integer,stance text);
      INSERT INTO users VALUES(1,'clerk-a'),(2,'clerk-b'); INSERT INTO reps VALUES('H');
      INSERT INTO bills VALUES(7,7,'hr'); INSERT INTO interactions VALUES(1,1,7,'approve');`);
    await pool.query(await readFile(new URL('../supabase/migrations/20261028202229_elections_storage.sql',import.meta.url),'utf8'));
    await pool.query(await readFile(new URL('../supabase/migrations/20261028202239_election_discovery_observations.sql',import.meta.url),'utf8'));
    await pool.query(await readFile(new URL('../supabase/migrations/20261028202247_election_feed_build_jobs.sql',import.meta.url),'utf8'));
    const checkedAt=new Date().toISOString(), reviewAfter=new Date(Date.now()+86400000).toISOString();
    const evidence={url:'https://elections.example.test/list',checkedAt};
    const race={office:'house',state:'AK',district:0,electionDate:'2026-11-03',stage:'general',contestType:'regular'};
    const fixture={name:'Fixture Candidate',identity:{system:'state:AK:2026:candidate',id:'001',evidence},race,raceEvidence:evidence,
      eligibility:'ballot-confirmed',eligibilityEvidence:{...evidence,system:'state:AK:ballot'},party:'Independent'};
    let imported,site,snapshot,version,geography;
    const auth={clerkUserId:'clerk-a'}, other={clerkUserId:'clerk-b'};
    const claimId=randomUUID();
    const validation={outcome:'valid',validatorVersion:'fixture-v1',reasons:[]};
    const siteInput=id=>({candidacyId:id,url:'https://campaign.example.test/issues',status:'verified',checkedAt,reviewAfter,
      approvedDestinations:[{origin:'https://campaign.example.test',pathPrefix:'/issues'}],
      evidence:{url:evidence.url,excerpt:'Official candidate site',method:'state-record',verifierVersion:'fixture-v1'}});
    const publish=(source,items,extra={})=>elections.publishCampaignPositions({candidacyId:source.candidacy_id,snapshotId:source.id,
      model:'fixture-model',promptVersion:'fixture-prompt-v1',completeness:'complete',items,...extra},pool);
    const item=(source,text='Build more housing.',id=claimId)=>({claimId:id,candidacyId:source.candidacy_id,snapshotId:source.id,
      claimText:text,topic:'housing',summary:text,excerpt:text,validation});
    const capture=(text,url='https://campaign.example.test/issues')=>elections.saveCampaignSnapshot({candidacyId:imported.candidacy.id,
      siteId:site.id,requestedUrl:url,finalUrl:url,retrievedAt:checkedAt,text},pool);
    const read=(extra={},who=null)=>elections.readElectionPositions({state:'AK',district:0,geographyEvidenceId:geography?.id,...extra},who,pool);

    await t.test('source identities, race identity and additive legislative preservation',async()=>{
      imported=await elections.importElectionCandidate(fixture,pool);
      assert.equal((await elections.importElectionCandidate(fixture,pool)).candidacy.id,imported.candidacy.id);
      const sameName=await elections.importElectionCandidate({...fixture,identity:{...fixture.identity,id:'002'}},pool);
      assert.notEqual(sameName.candidateId,imported.candidateId);
      for (const [seat,type] of [[1,'regular'],[2,'regular'],[1,'special']]) {
        await elections.importElectionCandidate({...fixture,race:{...race,office:'senate',district:null,senateSeat:seat,contestType:type}},pool);
      }
      assert.equal((await pool.query('SELECT count(*)::int n FROM election_races')).rows[0].n,4);
      await assert.rejects(elections.importElectionCandidate({...fixture,identity:{...fixture.identity,id:'003'},candidateId:imported.candidateId},pool),/cross-reference/);
      await elections.importElectionCandidate({...fixture,eligibility:'filed',eligibilityEvidence:{system:'fec:candidate',...evidence}},pool);
      assert.equal((await pool.query('SELECT eligibility FROM election_candidacies WHERE id=$1',[imported.candidacy.id])).rows[0].eligibility,'ballot-confirmed');
      assert.equal((await pool.query('SELECT stance FROM interactions WHERE id=1')).rows[0].stance,'approve');
      // A later bad record must roll back earlier records in the same race batch.
      await assert.rejects(elections.reconcileElectionRace({race,records:[
        {...fixture,identity:{...fixture.identity,id:'batch-first'}},
        {...fixture,identity:{...fixture.identity,id:'batch-bad'},eligibility:'invalid'}]},pool));
      assert.equal((await pool.query("SELECT count(*)::int n FROM election_candidate_identities WHERE source_id='batch-first'")).rows[0].n,0);
      await Promise.all([elections.importElectionCandidate(fixture,pool),elections.importElectionCandidate(fixture,pool)]);
      assert.equal((await pool.query("SELECT count(*)::int n FROM election_candidate_identities WHERE source_id='001'")).rows[0].n,1);
    });
    await t.test('verified site revisions and immutable retry-safe source evidence',async()=>{
      await assert.rejects(elections.saveCampaignSite({...siteInput(imported.candidacy.id),reviewAfter:null},pool));
      site=await elections.saveCampaignSite(siteInput(imported.candidacy.id),pool);
      snapshot=await capture('Build more housing. Expand healthcare.');
      assert.equal((await capture(snapshot.source_text)).id,snapshot.id);
      assert.equal((await pool.query('SELECT count(*)::int n FROM campaign_fetch_attempts')).rows[0].n,2);
      await assert.rejects(capture('bad','https://unapproved.example.test/issues'),/approved/);
      await assert.rejects(pool.query('UPDATE campaign_sources SET source_text=$2 WHERE id=$1',[snapshot.id,'rewritten']),/immutable/);
      const wrong=await elections.importElectionCandidate({...fixture,identity:{...fixture.identity,id:'004'}},pool);
      await assert.rejects(elections.saveCampaignSnapshot({candidacyId:wrong.candidacy.id,siteId:site.id,text:'bad',requestedUrl:site.proposed_url,finalUrl:site.proposed_url,retrievedAt:checkedAt},pool));
    });
    await t.test('atomic publication, invalid evidence and retry duplicate prevention',async()=>{
      [version]=await publish(snapshot,[item(snapshot)]);
      assert.equal((await publish(snapshot,[item(snapshot)]))[0].id,version.id);
      await assert.rejects(publish(snapshot,[item(snapshot,'Expand healthcare.',randomUUID()),item(snapshot,'Invented claim.',randomUUID())]));
      // Force a constraint error AFTER a preceding valid item was inserted.
      await assert.rejects(publish(snapshot,[item(snapshot,'Expand healthcare.',randomUUID()),item(snapshot,'Build more housing.','not-a-uuid')]));
      assert.equal((await pool.query('SELECT count(*)::int n FROM campaign_position_versions')).rows[0].n,1);
      await assert.rejects(pool.query('UPDATE campaign_position_versions SET summary=$2 WHERE id=$1',[version.id,'changed']),/immutable/);
    });
    await t.test('owned responses, comment clearing, guests and ownership overrides',async()=>{
      const first=await elections.saveElectionResponse(auth,{positionVersionId:version.id,stance:'approve',privateComment:'private A'},pool);
      const changed=await elections.saveElectionResponse(auth,{positionVersionId:version.id,stance:'disapprove'},pool);
      assert.equal(first.id,changed.id);
      assert.equal((await elections.saveElectionResponse(auth,{positionVersionId:version.id,stance:null},pool)).private_comment,'private A');
      assert.equal(await elections.getElectionResponse(other,version.id,pool),null);
      assert.equal(await elections.deleteElectionResponse(other,version.id,pool),null);
      await elections.saveElectionResponse(other,{positionVersionId:version.id,stance:'approve',privateComment:'private B'},pool);
      await assert.rejects(elections.saveElectionResponse(null,{positionVersionId:version.id,stance:'approve'},pool),/Authentication/);
      await assert.rejects(elections.saveElectionResponse(auth,{positionVersionId:version.id,stance:'approve',userId:2},pool),/override/);
      await assert.rejects(elections.getElectionResponse({...auth,userId:2},version.id,pool),/mismatch/);
      await assert.rejects(elections.saveElectionResponse(auth,{positionVersionId:version.id,stance:'other'},pool));
    });
    await t.test('matching geography, eligibility, sources and requesting-user-only reads',async()=>{
      assert.equal((await read()).items.length,0);
      const roster=await elections.readElectionRoster({state:'AK',chamber:'all',scope:{...RELEASE_SCOPE,states:['AK']},geography:{
        state:'AK',district:0,status:'verified',cycle:RELEASE_SCOPE.cycle,boundaryVersion:ELECTION_GEOGRAPHY_VERSION,sourceUrl:ELECTION_GEOGRAPHY_SOURCE,
      }},pool);
      assert.equal(roster.candidates.length,5);
      assert.equal(roster.candidates.filter(candidate=>candidate.race.office==='house').length,3);
      assert.ok(roster.candidates.every(candidate=>candidate.incumbency==='unknown'));
      const stale=await elections.saveElectionGeography({state:'AK',district:0,cycle:2026,boundaryVersion:'119th',sourceUrl:evidence.url,checkedAt,status:'verified'},pool);
      assert.equal((await read({geographyEvidenceId:stale.id})).houseAvailability,'geography-unverified');
      geography=await elections.saveElectionGeography({state:'AK',district:0,cycle:2026,boundaryVersion:ELECTION_GEOGRAPHY_VERSION,sourceUrl:ELECTION_GEOGRAPHY_SOURCE,checkedAt,status:'verified'},pool);
      const result=await read({},auth);
      assert.equal(result.items.length,1); assert.equal(result.items[0].summary,'Build more housing.');
      assert.equal(result.items[0].response,null);
      assert.equal(result.items[0].source.snapshotId,snapshot.id);
      assert.equal((await read()).items[0].response,null);
      const otherResponse=(await read({},other)).items[0].response;
      assert.deepEqual(otherResponse,{stance:'approve'});
      assert.equal(Object.hasOwn(otherResponse,'privateComment'),false);
      await elections.clearElectionResponse(auth,version.id,pool);
      assert.equal((await elections.getElectionResponse(auth,version.id,pool)).private_comment,'private A');
      assert.equal((await read({district:1})).items.length,0);
      await elections.importElectionCandidate({...fixture,eligibility:'withdrawn',eligibilityEvidence:{...fixture.eligibilityEvidence,
        checkedAt:new Date(Date.parse(checkedAt)+1000).toISOString()}},pool);
      assert.equal((await read()).items.length,0);
      await elections.importElectionCandidate(fixture,pool);
      assert.equal((await read()).items.length,0); // An ordinary/older list cannot undo withdrawal.
      await elections.importElectionCandidate({...fixture,eligibilityEvidence:{...fixture.eligibilityEvidence,reinstated:true,
        checkedAt:new Date(Date.parse(checkedAt)+2000).toISOString()}},pool);
      await assert.rejects(read({scope:{cycle:2028}}),/Scope/);
      await assert.rejects(elections.readElectionPositions({state:'AK'},null,{connect:async()=>{throw new Error('storage unavailable');}}),/storage unavailable/);
    });
    await t.test('HTTP feed, roster and response routes resolve trusted geography and hide private comments',async()=>{
      const secondCandidate=await elections.importElectionCandidate({...fixture,name:'Second Fixture Candidate',
        identity:{...fixture.identity,id:'api-house-two'}} ,pool);
      const secondSite=await elections.saveCampaignSite(siteInput(secondCandidate.candidacy.id),pool);
      const secondSnapshot=await elections.saveCampaignSnapshot({candidacyId:secondCandidate.candidacy.id,siteId:secondSite.id,
        requestedUrl:secondSite.proposed_url,finalUrl:secondSite.proposed_url,retrievedAt:checkedAt,text:'Support small businesses.'},pool);
      await elections.publishCampaignPositions({candidacyId:secondCandidate.candidacy.id,snapshotId:secondSnapshot.id,
        model:'fixture-model',promptVersion:'fixture-prompt-v1',completeness:'complete',items:[{
          claimId:randomUUID(),candidacyId:secondCandidate.candidacy.id,snapshotId:secondSnapshot.id,
          claimText:'Support small businesses.',topic:'economy',summary:'Support small businesses.',excerpt:'Support small businesses.',validation,
        }]},pool);
      await pool.query('UPDATE users SET election_geography_evidence_id=$1 WHERE id=2',[geography.id]);
      const app=express(); app.use(express.json());
      app.use((req,_res,next)=>{
        const signedIn=req.get('x-test-user')==='clerk-b';
        req.auth=()=>({userId:signedIn?'clerk-b':null});
        req.user=signedIn?{id:2,state:'AK'}:null;
        next();
      });
      app.use('/elections',electionsRouter);
      const server=app.listen(0,'127.0.0.1');
      await new Promise(resolve=>server.once('listening',resolve));
      const originalFetch=globalThis.fetch, originalDbQuery=db.query, originalDbConnect=db.connect;
      db.query=pool.query.bind(pool); db.connect=pool.connect.bind(pool);
      globalThis.fetch=async(url,options)=>{
        if(String(url).startsWith('https://geocoding.geo.census.gov/')) return {ok:true,json:async()=>({result:{addressMatches:[{geographies:{
          States:[{STUSAB:'AK',STATE:'02'}],
          '120th Congressional Districts':[{STATE:'02',GEOID:'0200',CD120:'00',CDSESSN:'120'}],
        }}]}})};
        return originalFetch(url,options);
      };
      const base=`http://127.0.0.1:${server.address().port}/elections`;
      const post=(path,body,headers={})=>originalFetch(`${base}/${path}`,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
      try {
        const guestRosterResponse=await post('roster',{address:'1 Example Ave, Anchorage, AK 99501',chamber:'house'});
        assert.equal(guestRosterResponse.status,200);
        const guestRoster=await guestRosterResponse.json();
        assert.equal(guestRoster.geography.houseDistrict,0);
        assert.equal(guestRoster.candidates.length,4);
        const guestFeedResponse=await post('feed',{address:'1 Example Ave, Anchorage, AK 99501',chamber:'house',limit:10});
        assert.equal(guestFeedResponse.status,200);
        const guestFeed=await guestFeedResponse.json();
        assert.equal(guestFeed.items.length,2);
        assert.equal(guestFeed.policyCounts.all,2);
        assert.equal(guestFeed.policyCounts.byPolicyArea.housing,1);
        assert.equal(guestFeed.items[0].response,null);
        assert.equal(Object.hasOwn(guestFeed.items[0].response??{},'privateComment'),false);
        const filtered=await post('feed',{address:'1 Example Ave, Anchorage, AK 99501',chamber:'house',candidacyId:secondCandidate.candidacy.id,policyArea:'economy',limit:10});
        const filteredFeed=await filtered.json();
        assert.equal(filtered.status,200);
        assert.equal(filteredFeed.items.length,1);
        assert.equal(filteredFeed.items[0].candidacyId,secondCandidate.candidacy.id);
        assert.equal(filteredFeed.policyCounts.all,1);
        assert.equal(filteredFeed.policyCounts.byPolicyArea.economy,1);
        const spoofedGeography=await post('feed',{state:'AK',district:0});
        assert.equal(spoofedGeography.status,400);

        const authHeaders={'x-test-user':'clerk-b'};
        const signedFeedResponse=await post('feed',{chamber:'house',limit:10},authHeaders);
        assert.equal(signedFeedResponse.status,200);
        const signedFeed=await signedFeedResponse.json();
        const signedVersion=signedFeed.items.find(item=>item.positionVersionId===version.id);
        assert.deepEqual(signedVersion.response,{stance:'agree'});
        const changed=await originalFetch(`${base}/responses/${version.id}`,{method:'PUT',headers:{...authHeaders,'Content-Type':'application/json'},body:JSON.stringify({stance:'disagree'})});
        assert.equal(changed.status,200);
        assert.deepEqual((await changed.json()).response,{positionVersionId:version.id,stance:'disagree'});
        assert.equal((await elections.getElectionResponse(other,version.id,pool)).private_comment,'private B');
        const alignmentResponse=await post('alignment',{chamber:'house',candidacyId:imported.candidacy.id},authHeaders);
        assert.equal(alignmentResponse.status,200);
        assert.deepEqual(await alignmentResponse.json(),{agreementCount:0,disagreementCount:1,answeredCount:1,percentage:0,status:'ready'});
        const cleared=await originalFetch(`${base}/responses/${version.id}`,{method:'DELETE',headers:authHeaders});
        assert.equal(cleared.status,200);
        assert.deepEqual((await cleared.json()).response,{positionVersionId:version.id,stance:null});
        assert.equal((await elections.getElectionResponse(other,version.id,pool)).private_comment,'private B');
        const unauthorized=await originalFetch(`${base}/responses/${version.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({stance:'agree'})});
        assert.equal(unauthorized.status,401);
        assert.equal((await unauthorized.json()).code,'AUTHENTICATION_REQUIRED');
      } finally {
        await elections.importElectionCandidate({...fixture,name:'Second Fixture Candidate',
          identity:{...fixture.identity,id:'api-house-two'},eligibility:'withdrawn',
          eligibilityEvidence:{...fixture.eligibilityEvidence,checkedAt:new Date(Date.parse(checkedAt)+5000).toISOString()},
        },pool);
        globalThis.fetch=originalFetch; db.query=originalDbQuery; db.connect=originalDbConnect;
        await new Promise(resolve=>server.close(resolve));
      }
    });
    await t.test('address lookup binds election district and verified geography to the read',async()=>{
      const geographies={States:[{STUSAB:'AK',GEOID:'02'}],'120th Congressional Districts':[{STATE:'02',GEOID:'0200',CD120:'00',CDSESSN:'120'}]};
      const fetcher=async()=>({ok:true,json:async()=>({result:{addressMatches:[{geographies}]}})});
      const result=await readElectionPositionsForAddress('fixture address',{state:'CA',district:99},null,pool,{fetcher});
      assert.equal(result.houseAvailability,null); assert.ok(result.races.some(row=>row.office==='house'&&row.state==='AK'&&row.district===0));
      const failed=async()=>({ok:true,json:async()=>({result:{addressMatches:[]}})});
      await assert.rejects(readElectionPositionsForAddress('fixture',{},null,pool,{fetcher:failed}),/could not be verified/);
    });
    await t.test('failed/partial refresh retains successful data, changes preserve history',async()=>{
      await elections.recordCampaignFailure({candidacyId:imported.candidacy.id,snapshotId:snapshot.id,status:'extraction-failed'},pool);
      let result=await read(); assert.equal(result.items.length,1); assert.equal(result.items[0].availability,'extraction-failed');
      assert.equal(new Date(result.items[0].source.retrievedAt).toISOString(),checkedAt);
      const revised=await capture('Build affordable housing. Expand healthcare.');
      const [replacement]=await publish(revised,[item(revised,'Build affordable housing.')]);
      assert.notEqual(replacement.id,version.id);
      assert.equal((await elections.getElectionResponse(auth,version.id,pool)).private_comment,'private A');
      assert.equal((await read({},auth)).items[0].response,null);
      assert.equal((await pool.query('SELECT state FROM campaign_position_versions WHERE id=$1',[version.id])).rows[0].state,'superseded');
      await publish(revised,[],{completeness:'partial'}); assert.equal((await read()).items.length,1);
      await publish(revised,[]); result=await read(); assert.equal(result.items.length,0);
      assert.equal(result.races.find(r=>r.candidacy_id===imported.candidacy.id).availability,'no-positions');
      assert.equal((await elections.getElectionResponse(auth,version.id,pool)).private_comment,'private A');
      await publish(revised,[item(revised,'Build affordable housing.'),item(revised,'Expand healthcare.',randomUUID())]);
      const page=await read({limit:1}); assert.ok(page.nextCursor);
      assert.equal(page.policyCounts.all,2);
      assert.equal(page.policyCounts.byPolicyArea.housing,2);
      assert.equal((await read({limit:1,cursor:page.nextCursor})).items.length,1);
      await elections.recordCampaignFailure({candidacyId:imported.candidacy.id,status:'crawl-failed'},pool);
      await assert.rejects(read({limit:1,cursor:page.nextCursor}),/restart/);
      await elections.saveCampaignSite({...siteInput(imported.candidacy.id),status:'proposed'},pool);
      assert.equal((await read()).items.length,0);
      await assert.rejects(publish(revised,[item(revised,'Build affordable housing.')]),/verified/);
      assert.equal((await pool.query('SELECT count(*)::int n FROM campaign_sources')).rows[0].n,3);
      site=await elections.saveCampaignSite(siteInput(imported.candidacy.id),pool);
      assert.equal((await read()).items.length,0);
      const reverified=await capture('Build affordable housing.');
      const [republished]=await publish(reverified,[item(reverified,'Build affordable housing.')]);
      assert.equal(republished.id,replacement.id);
      assert.equal((await read()).items.length,1);
      await elections.deleteElectionResponse(auth,version.id,pool);
      assert.equal(await elections.getElectionResponse(auth,version.id,pool),null);
      assert.equal((await elections.getElectionResponse(other,version.id,pool)).private_comment,'private B');
    });
    await t.test('ingestion completeness and browser role permission enforcement',async()=>{
      const run=await elections.startElectionRun({stage:'discovery',adapter:'fixture',adapterVersion:'1'},pool);
      await assert.rejects(elections.finishElectionRun(run.id,{status:'complete',coverage:[]},pool),/coverage/);
      await elections.finishElectionRun(run.id,{status:'partial',coverage:[{state:'AK',office:'house',status:'partial'},{state:'AK',office:'senate',status:'partial'}],counts:{read:4},errorCodes:['source-timeout']},pool);
      assert.equal((await read()).coverage.status,'partial');
      const tables=(await pool.query(`SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'election_%' OR tablename LIKE 'campaign_%')`)).rows;
      assert.equal(tables.length,19);
      const tablePrivileges=(await pool.query(`
        SELECT c.relname AS name,c.relrowsecurity,
          (has_table_privilege('anon',c.oid,'SELECT') OR has_table_privilege('anon',c.oid,'INSERT')
            OR has_table_privilege('anon',c.oid,'UPDATE') OR has_table_privilege('anon',c.oid,'DELETE')
            OR has_table_privilege('anon',c.oid,'TRUNCATE') OR has_table_privilege('anon',c.oid,'REFERENCES')
            OR has_table_privilege('anon',c.oid,'TRIGGER') OR has_table_privilege('anon',c.oid,'MAINTAIN')) AS anon_any_table_privilege,
          (has_table_privilege('authenticated',c.oid,'SELECT') OR has_table_privilege('authenticated',c.oid,'INSERT')
            OR has_table_privilege('authenticated',c.oid,'UPDATE') OR has_table_privilege('authenticated',c.oid,'DELETE')
            OR has_table_privilege('authenticated',c.oid,'TRUNCATE') OR has_table_privilege('authenticated',c.oid,'REFERENCES')
            OR has_table_privilege('authenticated',c.oid,'TRIGGER') OR has_table_privilege('authenticated',c.oid,'MAINTAIN')) AS authenticated_any_table_privilege,
          has_table_privilege('service_role',c.oid,'SELECT') AS service_select,
          has_table_privilege('service_role',c.oid,'INSERT') AS service_insert,
          has_table_privilege('service_role',c.oid,'UPDATE') AS service_update,
          has_table_privilege('service_role',c.oid,'DELETE') AS service_delete,
          has_table_privilege('service_role',c.oid,'TRUNCATE') AS service_truncate,
          has_table_privilege('service_role',c.oid,'REFERENCES') AS service_references,
          has_table_privilege('service_role',c.oid,'TRIGGER') AS service_trigger,
          has_table_privilege('service_role',c.oid,'MAINTAIN') AS service_maintain
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p')
          AND (c.relname LIKE 'election_%' OR c.relname LIKE 'campaign_%')
      `)).rows;
      assert.equal(tablePrivileges.length,19);
      for (const table of tablePrivileges) {
        assert.equal(table.relrowsecurity,true,`${table.name} RLS`);
        assert.equal(table.anon_any_table_privilege,false,`${table.name} anon privileges`);
        assert.equal(table.authenticated_any_table_privilege,false,`${table.name} authenticated privileges`);
        assert.equal(table.service_select,true,`${table.name} service SELECT`);
        assert.equal(table.service_insert,true,`${table.name} service INSERT`);
        const discoveryTable=table.name.startsWith('election_discovery_')
          || table.name==='election_source_documents'
          || table.name==='election_observation_resolutions';
        assert.equal(table.service_update,!discoveryTable,`${table.name} service UPDATE`);
        assert.equal(table.service_delete,!discoveryTable,`${table.name} service DELETE`);
        for (const privilege of ['truncate','references','trigger','maintain']) {
          assert.equal(table[`service_${privilege}`],false,`${table.name} service ${privilege.toUpperCase()}`);
        }
      }
      const client=await pool.connect();
      try {
        for (const role of ['anon','authenticated']) {
          await client.query(`SET ROLE ${role}`);
          for (const table of tables) {
            assert.equal(table.rowsecurity,true);
            const column=table.tablename==='election_candidate_identities' ? 'system'
              : table.tablename==='campaign_position_evidence' ? 'snapshot_id'
              : table.tablename==='election_observation_resolutions' ? 'observation_id' : 'id';
            for (const sql of [`SELECT * FROM ${table.tablename}`,`DELETE FROM ${table.tablename}`,`UPDATE ${table.tablename} SET ${column}=${column}`,`INSERT INTO ${table.tablename} DEFAULT VALUES`]) {
              await assert.rejects(client.query(sql),error=>error.code==='42501');
            }
            assert.equal((await client.query('SELECT has_table_privilege(current_user,$1,\'SELECT,INSERT,UPDATE,DELETE\') allowed',[`public.${table.tablename}`])).rows[0].allowed,false);
          }
          await client.query('RESET ROLE');
        }
        // service_role is granted table access but NOLOGIN/NOBYPASSRLS here: no policy means no rows.
        await client.query('SET ROLE service_role');
        assert.equal((await client.query('SELECT * FROM election_interactions')).rows.length,0);
        await client.query('RESET ROLE');
      } finally { await client.query('RESET ROLE'); client.release(); }
    });
  } finally {
    if(pool) await pool.end();
    await admin.query(`DROP DATABASE ${database} WITH (FORCE)`); await admin.end();
  }
});
