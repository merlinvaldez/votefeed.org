import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from '../server/node_modules/pg/lib/index.js';
import { importElectionCandidate, readElectionPositions, saveCampaignSite } from '../server/src/db/queries/elections.js';
import { crawlCampaignSite } from '../server/src/elections/crawlCampaign.js';
import { syncCampaignPositions } from '../server/src/elections/syncCampaignPositions.js';

const enabled=process.env.ELECTIONS_CAMPAIGN_LIVE_ACCEPTANCE==='1'
  && process.env.ELECTIONS_TEST_POSTGRES==='1'
  && Boolean(process.env.OPENAI_API_KEY);

test('bounded live ambiguous-site crawl saves exact-source positions to the feed', {
  skip:enabled ? false : 'Set ELECTIONS_CAMPAIGN_LIVE_ACCEPTANCE=1 and use the isolated test PostgreSQL runner with OPENAI_API_KEY.',
}, async () => {
  const config={host:'127.0.0.1',port:55439,user:'postgres',database:'postgres',ssl:false};
  const admin=new pg.Client(config);
  await admin.connect();
  const database=`campaign_live_${randomUUID().replaceAll('-','')}`;
  let pool;

  try {
    await admin.query(`CREATE DATABASE ${database}`);
    pool=new pg.Pool({...config,database});

    for (const role of ['anon','authenticated','service_role']) {
      await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
    }

    await pool.query(`
      CREATE TABLE users(id serial PRIMARY KEY, clerk_user_id text UNIQUE);
      CREATE TABLE reps(bioguideid text PRIMARY KEY);
      CREATE TABLE bills(id serial PRIMARY KEY, title text);
    `);
    for (const name of ['20261026194547_elections_storage.sql','20261026203305_election_discovery_observations.sql']) {
      await pool.query(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
    }

    const checkedAt=new Date().toISOString();
    const race={office:'house',state:'NY',district:9,electionDate:'2026-11-03',stage:'general',contestType:'regular'};
    const fecId='H4NY11138';
    const imported=await importElectionCandidate({
      identity:{system:'fec:candidate',id:fecId,evidence:{url:'https://api.open.fec.gov/v1/candidates',checkedAt}},
      name:'CLARKE, YVETTE D',race,
      raceEvidence:{url:'https://api.open.fec.gov/v1/candidates',checkedAt,basis:'fec-registration',ballotConfirmed:false},
      party:'DEM',eligibility:'unknown',eligibilityEvidence:{system:'fec:candidate',id:fecId},
    },pool);
    const candidate={name:'CLARKE, YVETTE D',fecId,office:'house',state:'NY',district:9,senateSeat:null,electionDate:'2026-11-03'};
    await saveCampaignSite({
      candidacyId:imported.candidacy.id,
      url:'https://voteyvette.com/',
      status:'ambiguous',
      approvedDestinations:[
        {origin:'https://voteyvette.com',pathPrefix:'/'},
        {origin:'https://www.voteyvette.com',pathPrefix:'/'},
      ],
      evidence:{
        url:'https://voteyvette.com/',excerpt:'Existing candidate-site sample for a bounded live crawl.',
        method:'live-acceptance-fixture',verifierVersion:'acceptance-v1',checkedAt,candidate,
      },
      checkedAt,
      reviewAfter:new Date(Date.now()+7*86400000).toISOString(),
      invalidationReason:'candidate-race-match-unclear',
    },pool);

    const result=await syncCampaignPositions({
      scope:{states:['NY'],offices:['house']},candidacyId:imported.candidacy.id,maxPages:2,db:pool,
    });
    assert.equal(result.status,'complete');
    assert.equal(result.counts.candidaciesFound,1);
    assert.equal(result.counts.crawledSuccess,1);
    assert.ok(result.counts.snapshotsSaved>0,'Expected the live crawler to save at least one campaign page.');
    assert.ok(result.counts.positionsPublished>0,'Expected the live extractor to publish at least one validated position.');

    const published=(await pool.query(`
      SELECT p.topic,p.summary,p.excerpt,s.final_url,s.source_text
      FROM campaign_position_versions p JOIN campaign_sources s ON s.id=p.snapshot_id
      WHERE p.candidacy_id=$1 AND p.state='published'
      ORDER BY p.topic,p.id
    `,[imported.candidacy.id])).rows;
    assert.ok(published.length>0);
    for (const item of published) assert.ok(item.source_text.includes(item.excerpt),`Excerpt is absent from ${item.final_url}`);

    const geo=(await pool.query(`
      INSERT INTO election_geography_evidence(state,cycle,boundary_version,source_url,checked_at,status)
      VALUES('NY',2026,'ACS2026_Current:120th','https://www.census.gov/programs-surveys/decennial-census/about/rdo/congressional-districts.html',now(),'verified')
      RETURNING id
    `)).rows[0];
    const feed=await readElectionPositions({state:'NY',district:9,geographyEvidenceId:geo.id},null,pool);
    const feedItems=feed.items.filter(item=>item.candidacyId===imported.candidacy.id);
    assert.equal(feedItems.length,published.length);
    assert.ok(feedItems.every(item=>item.ballotStatus==='unknown' && item.registrationStatus==='fec-registered'));

    console.log('LIVE_ACCEPTANCE_SUMMARY '+JSON.stringify({
      site:'https://voteyvette.com/',siteStatus:'ambiguous',status:result.status,
      crawled:result.counts.crawledSuccess,snapshots:result.counts.snapshotsSaved,
      published:published.map(({topic,summary,excerpt,final_url})=>({topic,summary,excerpt,sourceUrl:final_url})),
      feedItems:feedItems.length,feedBallotStatus:feedItems[0]?.ballotStatus,
      exactExcerptChecks:published.length,
    }));
  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${database}`);
    await admin.end();
  }
});

test('bounded live crawl sample returns no pages for inaccessible and no-policy-page campaign sites', {
  skip:enabled ? false : 'Run the isolated PostgreSQL test runner with ELECTIONS_CAMPAIGN_LIVE_ACCEPTANCE=1 and OPENAI_API_KEY.',
}, async () => {
  const checkedAt=new Date().toISOString();
  const cases=[
    {
      candidate:'WATKINS, VINSON L',
      siteUrl:'https://vincewatkins.org/',
      expectedCode:'discovery-dns-failed',
      approvedDestinations:[{origin:'https://vincewatkins.org',pathPrefix:'/'}],
      context:{name:'WATKINS, VINSON L',office:'senate',state:'GA',district:null,senateSeat:2,electionDate:'2026-11-03'},
    },
    {
      candidate:'BALOW, JILLIAN',
      siteUrl:'https://www.jillianbalowforwyoming.com/',
      expectedCode:'crawl-policy-pages-not-found',
      approvedDestinations:[{origin:'https://www.jillianbalowforwyoming.com',pathPrefix:'/'}],
      context:{name:'BALOW, JILLIAN',office:'house',state:'WY',district:0,senateSeat:null,electionDate:'2026-11-03'},
    },
  ];

  const outcomes=[];
  for (const sample of cases) {
    const site={
      proposed_url:sample.siteUrl,
      status:'ambiguous',
      approved_destinations:sample.approvedDestinations,
      review_after:new Date(Date.now()+7*86400000).toISOString(),
      evidence:{candidate:sample.context,checkedAt},
    };
    let errorCode=null;
    try {
      await crawlCampaignSite({site,maxPages:2,checkDns:true});
    } catch (error) {
      errorCode=error.code ?? 'crawl-failed';
    }
    assert.equal(errorCode,sample.expectedCode,`${sample.siteUrl} should return no pages for this live edge case`);
    outcomes.push({
      candidate:sample.candidate,
      siteUrl:sample.siteUrl,
      outcome:errorCode,
      pagesReturned:0,
    });
  }

  console.log('LIVE_CRAWL_EDGE_SUMMARY '+JSON.stringify({
    checkedAt,
    outcomes,
    productionDatabaseUsed:false,
  }));
});
