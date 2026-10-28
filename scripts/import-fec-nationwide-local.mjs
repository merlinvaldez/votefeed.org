import pg from '../server/node_modules/pg/lib/index.js';
import dotenv from '../server/node_modules/dotenv/lib/main.js';
import { readFile, writeFile } from 'node:fs/promises';
import { RELEASE_SCOPE } from '../server/src/elections/contracts.js';
import { syncCandidates } from '../server/src/elections/syncCandidates.js';
import { promoteElectionObservation } from '../server/src/db/queries/electionDiscovery.js';
dotenv.config({path:'server/.env',quiet:true});
if (!process.env.FEC_API_KEY) throw new Error('FEC_API_KEY required');
const config={host:'127.0.0.1',port:55439,user:'postgres',database:'postgres',ssl:false};
const name='votefeed_fec_candidates_2026_local';
const coverageOf=entry=>typeof entry.coverage==='string'?JSON.parse(entry.coverage):entry.coverage ?? {};
const normalizeEntry=entry=>({...entry,coverage:coverageOf(entry)});
const summarize=entries=>({scopes:entries.length,completeScopes:entries.filter(item=>item.status==='complete').length,
 committeeRequests:0,campaignSiteWrites:0,
 candidateSearchRecords:entries.reduce((sum,item)=>sum+(Number(coverageOf(item).fecCandidates) || 0),0),
 invalidRecords:entries.reduce((sum,item)=>sum+(Number(item.counts?.invalidRecords) || 0),0),
 validCandidateRecords:entries.reduce((sum,item)=>sum+(Number(coverageOf(item).fecCandidates) || 0),0)-
  entries.reduce((sum,item)=>sum+(Number(item.counts?.invalidRecords) || 0),0),
 unresolved:entries.reduce((sum,item)=>sum+(Number(item.counts?.unresolved) || 0),0)});
const admin=new pg.Client(config); await admin.connect(); let pool;
try {
 const exists=(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount>0;
 if (!exists) await admin.query(`CREATE DATABASE ${name}`);
 pool=new pg.Pool({...config,database:name});
 if (!exists) {
  for(const role of ['anon','authenticated','service_role']) await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
  await pool.query('CREATE TABLE users(id serial PRIMARY KEY,clerk_user_id text UNIQUE); CREATE TABLE reps(bioguideid text PRIMARY KEY); CREATE TABLE bills(id serial PRIMARY KEY,title text)');
  for(const migration of ['20261026194547_elections_storage.sql','20261026203305_election_discovery_observations.sql']) await pool.query(await readFile(new URL(`../supabase/migrations/${migration}`,import.meta.url),'utf8'));
  await pool.query('CREATE TABLE local_fec_candidate_import_scope (state text NOT NULL, office text NOT NULL, entry jsonb NOT NULL, PRIMARY KEY(state,office))');
 } else {
  const marker=await pool.query("SELECT to_regclass('public.local_fec_candidate_import_scope') AS name");
  if (!marker.rows[0].name) throw new Error('Existing database lacks audit marker; refusing to use it');
 }
 outer: for(const state of RELEASE_SCOPE.states) for(const office of RELEASE_SCOPE.offices) {
  const prior=(await pool.query('SELECT entry FROM local_fec_candidate_import_scope WHERE state=$1 AND office=$2',[state,office])).rows[0]?.entry;
  if(prior?.status==='complete') continue;
  const run=await syncCandidates({scope:{states:[state],offices:[office]},fecApiKey:process.env.FEC_API_KEY,
   verifySites:false,discoverCommittees:false,pool});
  const entry={state,office,status:run.status,counts:run.counts,coverage:run.coverage[0],errorCodes:run.errorCodes,checkedAt:new Date().toISOString(),runId:run.runId};
  await pool.query('INSERT INTO local_fec_candidate_import_scope(state,office,entry) VALUES($1,$2,$3) ON CONFLICT(state,office) DO UPDATE SET entry=excluded.entry',[state,office,entry]);
  const entries=(await pool.query('SELECT entry FROM local_fec_candidate_import_scope ORDER BY state,office')).rows.map(row=>normalizeEntry(row.entry));
  const summary=summarize(entries);
  await writeFile('specs/elections-fec-candidates-local-coverage.json',JSON.stringify({cycle:2026,source:'OpenFEC candidate search only',
   database:name,identityPolicy:'Each valid candidate-search record is keyed by its FEC candidate ID. Same-name records are kept separate unless explicitly linked; invalid records remain quarantined.',summary,entries},null,2)+'\n');
  console.log(JSON.stringify(entry));
  if(entry.errorCodes.some(code=>['discovery-rate-limited','discovery-retry-deferred'].includes(code))) break outer;
 }
 const pending=(await pool.query(`SELECT o.id FROM election_discovery_observations o
  JOIN election_source_documents d ON d.id=o.document_id
  LEFT JOIN election_observation_resolutions r ON r.observation_id=o.id
  WHERE d.system='fec:discovery' AND d.source_key ~ '^fec:[A-Z]{2}:(house|senate):candidates:all:[0-9]+$'
   AND o.validation->>'outcome'='valid' AND r.observation_id IS NULL ORDER BY d.source_key,o.id`)).rows;
 for(const observation of pending) await promoteElectionObservation(observation.id,{},pool);
 const rows=(await pool.query('SELECT entry FROM local_fec_candidate_import_scope ORDER BY state,office')).rows.map(row=>normalizeEntry(row.entry));
 const summary=summarize(rows);
 const audit=(await pool.query(`SELECT
  count(*) FILTER(WHERE o.validation->>'outcome'='valid')::int AS validObservations,
  count(*) FILTER(WHERE o.validation->>'outcome'='valid' AND r.observation_id IS NULL)::int AS unresolvedValidObservations,
  count(*) FILTER(WHERE o.validation->>'outcome'='invalid')::int AS invalidObservations
  FROM election_discovery_observations o JOIN election_source_documents d ON d.id=o.document_id
  LEFT JOIN election_observation_resolutions r ON r.observation_id=o.id
  WHERE d.system='fec:discovery' AND d.source_key ~ '^fec:[A-Z]{2}:(house|senate):candidates:all:[0-9]+$'`)).rows[0];
 summary.unresolved=Number(audit.unresolvedvalidobservations);
 summary.validCandidateSearchObservations=Number(audit.validobservations);
 summary.invalidCandidateSearchObservations=Number(audit.invalidobservations);
 await writeFile('specs/elections-fec-candidates-local-coverage.json',JSON.stringify({cycle:2026,source:'OpenFEC candidate search only',
  database:name,identityPolicy:'Each valid candidate-search record is keyed by its FEC candidate ID. Same-name records are kept separate unless explicitly linked; invalid records remain quarantined.',summary,entries:rows},null,2)+'\n');
 console.log(JSON.stringify({database:name,...summary}));
 if(summary.scopes!==100 || summary.completeScopes!==100 || summary.unresolved!==0) process.exitCode=1;
} finally { if(pool) await pool.end(); await admin.end(); }
