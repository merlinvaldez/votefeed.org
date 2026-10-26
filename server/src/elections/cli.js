import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import db from '../db/client.js';
import { syncCandidates } from './syncCandidates.js';
import { wyomingSource } from './sources/wyoming.js';
import { discoveryScope, safeCode } from './discoveryUtils.js';
import { extractWyoming, validateBallotRows } from './ballotExtraction.js';
import { createOpenAiDiscoveryProvider } from './openaiDiscoveryProvider.js';
import { promoteElectionObservation } from '../db/queries/electionDiscovery.js';
import { searchSourceCatalog, inspectSourceBatch, onboardingCoverage } from './sourceOnboarding.js';
import { RELEASE_SCOPE } from './contracts.js';

const {values} = parseArgs({options:{
  help:{type:'boolean'},states:{type:'string'},offices:{type:'string'},sources:{type:'string'},output:{type:'string'},
  write:{type:'boolean'},'skip-fec':{type:'boolean'},'fec-only':{type:'boolean'},'verify-sites':{type:'boolean'},'inspect-fixture':{type:'boolean'},
  'search-sources':{type:'boolean'},'max-pages':{type:'string'},'max-committees':{type:'string'},
  'resolve-observation':{type:'string'},'candidate-id':{type:'string'},actor:{type:'string'},'evidence-url':{type:'string'},reason:{type:'string'},
  'new-person':{type:'boolean'},
  checkpoint:{type:'string'},resume:{type:'boolean'},'inspect-sources':{type:'boolean'},archive:{type:'string'},
  concurrency:{type:'string'},
  'coverage-report':{type:'boolean'},inspection:{type:'string'},
}});
try {
  if (values.help) console.log(`Election discovery (server-only):
  --inspect-fixture                       Offline Wyoming extraction; no DB or AI calls
  --search-sources --states WY            AI source proposals; no DB writes or source approval
  --states all                           Explicitly select all 50 release states
  --checkpoint path.json [--resume]       Save each search; resume skips successes, retries gaps
  --concurrency 1                        Source searches in flight (1–3)
  --inspect-sources --sources path.json --archive directory
                                          Archive/read reviewed sources without DB writes
  --coverage-report --checkpoint path.json --sources path.json --inspection report.json
                                          Local state/office gap report; no network or DB writes
  --write --states WY [--skip-fec|--fec-only] Import into configured DATABASE_URL
  --sources path.json                     Reviewed source descriptors; default Wyoming sample
  --offices house,senate                   Narrow the release scope
  --verify-sites                          Check officially linked campaign homepages
  --max-pages 100 --max-committees 100      Bounded FEC work per state/office
  --resolve-observation UUID --candidate-id UUID --actor NAME --evidence-url URL --reason TEXT --write
                                          Record an explicit supported identity resolution
  --new-person                            Use instead of --candidate-id for a reviewed distinct person
  --output path.json                      Save safe summary/source proposals
Keys remain in the server environment. --write uses DATABASE_URL; no migrations are applied.`);
  else {
    if (!values.states && !values['inspect-fixture'] && !values['resolve-observation']) throw new Error('discovery-explicit-states-required');
    const scope = discoveryScope({states:values.states === 'all' ? RELEASE_SCOPE.states : values.states ? values.states.split(',').map(s=>s.trim().toUpperCase()) : ['WY'],
      ...(values.offices ? {offices:values.offices.split(',').map(s=>s.trim())} : {})});
    let result;
    if (values['inspect-fixture']) {
      const text = await readFile(new URL('../../../tests/fixtures/elections/discovery/2026-10-26/wy-general-candidates.csv',import.meta.url),'utf8');
      const records = validateBallotRows(extractWyoming(text,wyomingSource,scope),text,wyomingSource,scope);
      result = {mode:'offline-fixture',records:records.length,valid:records.filter(r=>r.validation.outcome === 'valid').length,
        websites:records.filter(r=>r.data.siteUrl).length,coverage:'partial',databaseWrites:false};
    } else if(values['coverage-report']) {
      const inventory=JSON.parse(await readFile(new URL('../../../specs/elections-source-inventory.json',import.meta.url),'utf8'));
      result=onboardingCoverage({scope,inventory,catalog:values.checkpoint?JSON.parse(await readFile(values.checkpoint,'utf8')):null,
        sources:values.sources?JSON.parse(await readFile(values.sources,'utf8')):[],
        inspection:values.inspection?JSON.parse(await readFile(values.inspection,'utf8')):null});
    } else if (values['search-sources']) {
      const inventory = JSON.parse(await readFile(new URL('../../../specs/elections-source-inventory.json',import.meta.url),'utf8'));
      result=await searchSourceCatalog({scope,inventory,provider:createOpenAiDiscoveryProvider(),
        checkpoint:values.checkpoint,resume:values.resume,concurrency:Number(values.concurrency??1),onProgress:entry=>console.error(JSON.stringify(entry))});
      if(result.states.some(s=>s.status!=='proposed')) process.exitCode=2;
    } else if(values['inspect-sources']) {
      if(!values.sources) throw new Error('discovery-source-file-required');
      const sources=JSON.parse(await readFile(values.sources,'utf8'));
      if(!Array.isArray(sources)) throw new Error('discovery-invalid-source-file');
      result=await inspectSourceBatch({scope,sources,archiveDirectory:values.archive,resume:values.resume,
        provider:sources.some(s=>!['wy-csv','mapped-csv'].includes(s.format))?createOpenAiDiscoveryProvider():null,
        onProgress:entry=>console.error(JSON.stringify(entry))});
      process.exitCode=2; // Inspection is partial evidence, never nationwide acceptance.
    } else {
      if (!values.write) throw new Error('discovery-write-flag-required');
      if (values['resolve-observation']) {
        if ((!values['candidate-id'] && !values['new-person']) || !values.actor || !values['evidence-url'] || !values.reason) throw new Error('discovery-resolution-evidence-required');
        result = await promoteElectionObservation(values['resolve-observation'],{candidateId:values['candidate-id'] ?? null,newPerson:values['new-person'] ?? false,actor:values.actor,
          review:{url:values['evidence-url'],reason:values.reason}},db);
      } else {
        const sources = values['fec-only'] || values.sources === 'none' ? [] : values.sources ? JSON.parse(await readFile(values.sources,'utf8')) : [wyomingSource];
        if (!Array.isArray(sources)) throw new Error('discovery-invalid-source-file');
        result = await syncCandidates({scope,sources,includeFec:!values['skip-fec'],fecApiKey:process.env.FEC_API_KEY,
          verifySites:values['verify-sites'] ?? false,maxPages:Number(values['max-pages'] ?? 100),maxCommittees:Number(values['max-committees'] ?? 100),
          provider:sources.some(s=>!['wy-csv','mapped-csv'].includes(s.format)) ? createOpenAiDiscoveryProvider() : null});
        if (['failed','partial','unsupported'].includes(result.status)) process.exitCode = 2;
      }
    }
    const text = `${JSON.stringify(result,null,2)}\n`;
    if (values.output) await writeFile(values.output,text,{flag:'wx'});
    console.log(text);
  }
} catch (error) {
  // Never print provider exception bodies, request headers, or connection strings.
  console.error(/^discovery-[a-z-]+$/.test(error.message) ? error.message : safeCode(error)); process.exitCode=1;
} finally { await db.end(); }
