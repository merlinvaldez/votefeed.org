import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from '../server/node_modules/pg/lib/index.js';
import * as elections from '../server/src/db/queries/elections.js';

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
    await pool.query(`CREATE TABLE users(id serial PRIMARY KEY,clerk_user_id text UNIQUE);
      CREATE TABLE reps(bioguideid text PRIMARY KEY);
      CREATE TABLE bills(id serial PRIMARY KEY,number integer,bill_type text);
      CREATE TABLE interactions(id serial PRIMARY KEY,user_id integer,bill_id integer,stance text);
      INSERT INTO users VALUES(1,'clerk-a'),(2,'clerk-b'); INSERT INTO reps VALUES('H');
      INSERT INTO bills VALUES(7,7,'hr'); INSERT INTO interactions VALUES(1,1,7,'approve');`);
    await pool.query(await readFile(new URL('../supabase/migrations/20261026194547_elections_storage.sql',import.meta.url),'utf8'));
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
      geography=await elections.saveElectionGeography({state:'AK',cycle:2026,boundaryVersion:'fixture-only',sourceUrl:evidence.url,checkedAt,status:'verified'},pool);
      const result=await read({},auth);
      assert.equal(result.items.length,1); assert.equal(result.items[0].summary,'Build more housing.');
      assert.equal(result.items[0].response.privateComment,'private A');
      assert.equal(result.items[0].source.snapshotId,snapshot.id);
      assert.equal((await read()).items[0].response,null);
      assert.equal((await read({},other)).items[0].response.privateComment,'private B');
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
      assert.equal((await read({limit:1,cursor:page.nextCursor})).items.length,1);
      await elections.recordCampaignFailure({candidacyId:imported.candidacy.id,status:'crawl-failed'},pool);
      await assert.rejects(read({limit:1,cursor:page.nextCursor}),/restart/);
      await elections.saveCampaignSite({...siteInput(imported.candidacy.id),status:'proposed'},pool);
      assert.equal((await read()).items.length,0);
      await assert.rejects(publish(revised,[item(revised,'Build affordable housing.')]),/verified/);
      assert.equal((await pool.query('SELECT count(*)::int n FROM campaign_sources')).rows[0].n,2);
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
      await elections.finishElectionRun(run.id,{status:'partial',coverage:[{state:'AK',status:'partial'}],counts:{read:4},errorCodes:['source-timeout']},pool);
      assert.equal((await read()).coverage.status,'partial');
      const tables=(await pool.query(`SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'election_%' OR tablename LIKE 'campaign_%')`)).rows;
      assert.equal(tables.length,14);
      const client=await pool.connect();
      try {
        for (const role of ['anon','authenticated']) {
          await client.query(`SET ROLE ${role}`);
          for (const table of tables) {
            assert.equal(table.rowsecurity,true);
            const column=table.tablename==='election_candidate_identities' ? 'system' : table.tablename==='campaign_position_evidence' ? 'snapshot_id' : 'id';
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
