import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from '../server/node_modules/pg/lib/index.js';
import dotenv from '../server/node_modules/dotenv/lib/main.js';
import { syncCandidates } from '../server/src/elections/syncCandidates.js';
dotenv.config({path:'server/.env',quiet:true});
test('bounded live FEC import into disposable PostgreSQL', {skip:process.env.ELECTIONS_LIVE_FEC!=='1',timeout:360000}, async () => {
 const config={host:'127.0.0.1',port:55439,user:'postgres',database:'postgres',ssl:false}; const admin=new pg.Client(config); await admin.connect(); const database=`fec_live_${randomUUID().replaceAll('-','')}`; let pool;
 try {
  await admin.query(`CREATE DATABASE ${database}`); pool=new pg.Pool({...config,database});
  for (const role of ['anon','authenticated','service_role']) await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
  await pool.query('CREATE TABLE users(id serial PRIMARY KEY,clerk_user_id text UNIQUE); CREATE TABLE reps(bioguideid text PRIMARY KEY); CREATE TABLE bills(id serial PRIMARY KEY,title text)');
  for (const name of ['20261028202229_elections_storage.sql','20261028202239_election_discovery_observations.sql']) await pool.query(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
  const args={scope:{states:['WY'],offices:['house']},fecApiKey:process.env.FEC_API_KEY,verifySites:true,maxCommittees:100,pool};
  const first=await syncCandidates(args); const count=(await pool.query('SELECT count(*)::int n FROM election_candidates')).rows[0].n; const second=await syncCandidates(args);
  const sites=(await pool.query("SELECT ca.name,s.proposed_url,s.status,s.invalidation_reason FROM campaign_sites s JOIN election_candidacies c ON c.id=s.candidacy_id JOIN election_candidates ca ON ca.id=c.candidate_id WHERE s.is_current AND s.proposed_url IS NOT NULL")).rows;
  console.log(JSON.stringify({sites,firstStatus:first.status,secondStatus:second.status,counts:first.counts,coverage:first.coverage,errorCodes:first.errorCodes,candidateCount:count}));
  assert.ok(count>0); assert.ok(sites.some(site=>site.status==='verified'), 'Live sample must verify a campaign site'); assert.equal((await pool.query('SELECT count(*)::int n FROM election_candidates')).rows[0].n,count);
  const arizona=await syncCandidates({scope:{states:['AZ'],offices:['house']},fecApiKey:process.env.FEC_API_KEY,verifySites:false,maxCommittees:1,pool});
  console.log(JSON.stringify({arizonaStatus:arizona.status,coverage:arizona.coverage,unresolved:arizona.counts.unresolved,errorCodes:arizona.errorCodes}));
  assert.equal(arizona.status,'partial'); assert.ok(arizona.errorCodes.includes('discovery-fec-invalid-record'));
  assert.ok(arizona.counts.unresolved>=1);
  const proposed = (await pool.query("SELECT data->>'siteUrl' AS url FROM election_discovery_observations WHERE data->>'fecId'='H6AZ08210' AND validation->>'outcome'='invalid' AND data->>'siteUrl' IS NOT NULL")).rows;
  assert.ok(proposed.length>0,'Missing-name record should retain its FEC committee website for review');

 } finally {if(pool) await pool.end(); await admin.query(`DROP DATABASE IF EXISTS ${database}`); await admin.end();}
});
