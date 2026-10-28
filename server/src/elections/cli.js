import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import db from '../db/client.js';
import { syncCandidates } from './syncCandidates.js';
import { discoveryScope, safeCode } from './discoveryUtils.js';
import { promoteElectionObservation } from '../db/queries/electionDiscovery.js';
import { syncCampaignPositions } from './syncCampaignPositions.js';
import { syncCampaignSiteDiscovery } from './syncCampaignSiteDiscovery.js';
import { RELEASE_SCOPE } from './contracts.js';

const {values} = parseArgs({options:{
  help:{type:'boolean'},states:{type:'string'},offices:{type:'string'},output:{type:'string'},
  write:{type:'boolean'},'verify-sites':{type:'boolean'},'candidate-only':{type:'boolean'},'discover-sites':{type:'boolean'},refresh:{type:'boolean'},
  'max-pages':{type:'string'},'max-committees':{type:'string'},'max-candidates':{type:'string'},
  'resolve-observation':{type:'string'},'candidate-id':{type:'string'},actor:{type:'string'},'evidence-url':{type:'string'},reason:{type:'string'},
  'new-person':{type:'boolean'},
  'crawl-campaigns':{type:'boolean'},
}});
try {
  if (values.help) console.log(`Election discovery (server-only):
  --states all                           Explicitly select all 50 release states
  --write --states WY                    Import FEC records into configured DATABASE_URL
  --candidate-only                       Skip per-candidate FEC committee lookups and site records
  --discover-sites --write --states WY --offices house
                                         Find likely campaign websites for matched FEC candidates
  --max-candidates 20 --max-pages 5      Bound AI search and site-page inspection work
  --refresh                              Recheck candidates with an existing current site record
  --crawl-campaigns --write [--states WY] [--candidate-id UUID] Crawl verified or ambiguous campaign sites & extract positions
  --offices house,senate                   Narrow the release scope
  --verify-sites                          Check officially linked campaign homepages
  --max-pages 100 --max-committees 1000     Bounded FEC work per state/office
  --resolve-observation UUID --candidate-id UUID --actor NAME --evidence-url URL --reason TEXT --write
                                          Record an explicit supported identity resolution
  --new-person                            Use instead of --candidate-id for a reviewed distinct person
  --output path.json                      Save safe summary/source proposals
Keys remain in the server environment. --write uses DATABASE_URL; no migrations are applied.`);
  else {
    if (!values.states && !values['resolve-observation']) throw new Error('discovery-explicit-states-required');
    const scope = discoveryScope({states:values.states === 'all' ? RELEASE_SCOPE.states : values.states ? values.states.split(',').map(s=>s.trim().toUpperCase()) : ['WY'],
      ...(values.offices ? {offices:values.offices.split(',').map(s=>s.trim())} : {})});
    let result;
    if(values['discover-sites']) {
      if (!values.write) throw new Error('discovery-write-flag-required');
      result = await syncCampaignSiteDiscovery({
        scope,
        candidacyId:values['candidate-id'] ?? null,
        maxCandidates:Number(values['max-candidates'] ?? 20),
        maxPages:Number(values['max-pages'] ?? 5),
        refresh:values.refresh ?? false,
        db,
      });
      if (['failed','partial'].includes(result.status)) process.exitCode = 2;
    } else if(values['crawl-campaigns']) {
      if (!values.write) throw new Error('discovery-write-flag-required');
      result = await syncCampaignPositions({
        scope,
        candidacyId: values['candidate-id'] ?? null,
        maxPages: Number(values['max-pages'] ?? 5),
        db
      });
      if (['failed','partial','unsupported'].includes(result.status)) process.exitCode = 2;
    } else {
      if (!values.write) throw new Error('discovery-write-flag-required');
      if (values['resolve-observation']) {
        if ((!values['candidate-id'] && !values['new-person']) || !values.actor || !values['evidence-url'] || !values.reason) throw new Error('discovery-resolution-evidence-required');
        result = await promoteElectionObservation(values['resolve-observation'],{candidateId:values['candidate-id'] ?? null,newPerson:values['new-person'] ?? false,actor:values.actor,
          review:{url:values['evidence-url'],reason:values.reason}},db);
      } else {
        result = await syncCandidates({scope,fecApiKey:process.env.FEC_API_KEY,
          verifySites:values['verify-sites'] ?? false,discoverCommittees:!values['candidate-only'],
          maxPages:Number(values['max-pages'] ?? 100),maxCommittees:Number(values['max-committees'] ?? 1000)});
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
