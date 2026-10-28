import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import pg from '../server/node_modules/pg/lib/index.js';
import dotenv from '../server/node_modules/dotenv/lib/main.js';
import { RELEASE_SCOPE } from '../server/src/elections/contracts.js';
import { syncCandidates } from '../server/src/elections/syncCandidates.js';
dotenv.config({path:'server/.env',quiet:true});

test('nationwide FEC candidate and committee import on disposable PostgreSQL', {skip:process.env.ELECTIONS_LIVE_FEC_NATIONWIDE!=='1',timeout:21600000},async()=>{
 const file='specs/elections-fec-committee-coverage.json';
 let report;try{report=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;report={cycle:2026,source:'OpenFEC candidate and authorized committee discovery',entries:[]};}
 const config={host:'127.0.0.1',port:55439,user:'postgres',database:'postgres',ssl:false};const admin=new pg.Client(config);await admin.connect();const database=`fec_audit_${randomUUID().replaceAll('-','')}`;let pool;
 try {
  await admin.query(`CREATE DATABASE ${database}`);pool=new pg.Pool({...config,database});
  for(const role of ['anon','authenticated','service_role']) await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
  await pool.query('CREATE TABLE users(id serial PRIMARY KEY,clerk_user_id text UNIQUE); CREATE TABLE reps(bioguideid text PRIMARY KEY); CREATE TABLE bills(id serial PRIMARY KEY,title text)');
  for(const name of ['20261026194547_elections_storage.sql','20261026203305_election_discovery_observations.sql']) await pool.query(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
  assert.ok(process.env.FEC_API_KEY,'FEC_API_KEY required');
  outer:for(const state of RELEASE_SCOPE.states) for(const office of RELEASE_SCOPE.offices){
   const prior=report.entries.find(e=>e.state===state&&e.office===office);
   const reviewOnly=['discovery-fec-invalid-record','discovery-unresolved-records','discovery-match-review-required','discovery-ambiguous-match','discovery-identity-conflict'];
   if(prior && (prior.status==='complete' || prior.status==='partial' && prior.errorCodes.length && prior.errorCodes.every(code=>reviewOnly.includes(code)) && (!prior.errorCodes.includes('discovery-fec-invalid-record') || prior.workerVersion==='missing-name-sites-v2'))) continue;
   const run=await syncCandidates({scope:{states:[state],offices:[office]},fecApiKey:process.env.FEC_API_KEY,verifySites:false,pool});
   const unresolvedProposedSites=(await pool.query(`SELECT count(DISTINCT o.data->>'siteUrl')::int AS n FROM election_discovery_observations o JOIN election_source_documents d ON d.id=o.document_id WHERE d.context->>'state'=$1 AND d.context->>'office'=$2 AND o.validation->>'outcome'='invalid' AND o.data->>'siteUrl' IS NOT NULL`,[state,office])).rows[0].n;
   const entry={state,office,status:run.status,counts:run.counts,coverage:run.coverage[0],errorCodes:run.errorCodes,unresolvedProposedSites,workerVersion:'missing-name-sites-v2',checkedAt:new Date().toISOString()};
   report.entries=report.entries.filter(e=>e.state!==state||e.office!==office);report.entries.push(entry);
   await writeFile(file,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(entry));
   if(entry.errorCodes.some(code=>['discovery-rate-limited','discovery-retry-deferred'].includes(code))) break outer;
  }
  assert.equal(report.entries.length,100,'Nationwide committee audit is incomplete; resume after any rate limit');
  assert.ok(report.entries.every(e=>e.status==='complete'),'Nationwide committee audit contains partial or failed scopes; review report');
 } finally {if(pool)await pool.end();await admin.query(`DROP DATABASE IF EXISTS ${database}`);await admin.end();}
});
