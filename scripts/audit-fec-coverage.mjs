import dotenv from '../server/node_modules/dotenv/lib/main.js';
import { readFile, writeFile } from 'node:fs/promises';
import { RELEASE_SCOPE } from '../server/src/elections/contracts.js';
import { fetchPublic } from '../server/src/elections/publicHttp.js';
import { fecPages } from '../server/src/elections/sources/fec.js';
dotenv.config({path:'server/.env',quiet:true});
if(!process.env.FEC_API_KEY) throw new Error('FEC_API_KEY required');
const output=process.argv[2]; if (!output) throw new Error('Provide checkpoint path');
let report; try { report=JSON.parse(await readFile(output,'utf8')); } catch(error) { if(error.code!=='ENOENT') throw error; report={cycle:2026,source:'OpenFEC candidate search',entries:[]}; }
outer: for (const state of RELEASE_SCOPE.states) for (const office of RELEASE_SCOPE.offices) {
 if(report.entries.some(e=>e.state===state&&e.office===office&&e.status==='complete')) continue;
 const entry={state,office,status:'failed',pages:0,candidates:0,invalidRecords:0};
 try {
  for await(const page of fecPages({state,office,apiKey:process.env.FEC_API_KEY,capture:async()=>({}),fetcher:async (...args)=>{await new Promise(resolve=>setTimeout(resolve,1300));return fetchPublic(...args);}})) {entry.pages++;entry.candidates+=page.records.length + page.invalidRecords.length;entry.invalidRecords+=page.invalidRecords.length;}
  entry.status=entry.invalidRecords ? 'partial' : 'complete';
  if(entry.invalidRecords) entry.error='discovery-fec-invalid-record';
 } catch(error){entry.error=error.code??'request-failed';}
 entry.checkedAt=new Date().toISOString(); report.entries=report.entries.filter(e=>e.state!==state||e.office!==office); report.entries.push(entry);
 await writeFile(output,JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify(entry));
 if (['discovery-retry-deferred','discovery-rate-limited'].includes(entry.error)) { process.exitCode=2; break outer; }
}
