import test from 'node:test';
import assert from 'node:assert/strict';
import { buildElectionGeographyUrl, extractElectionDistrict, resolveElectionDistrict } from '../server/src/elections/electionGeography.js';
const match={geographies:{States:[{STUSAB:'WY',GEOID:'56'}],'120th Congressional Districts':[{STATE:'56',GEOID:'5600',CD120:'00',CDSESSN:'120'}]}};
test('election geography uses the fixed 120th layer and handles at-large districts',async()=>{
 const url=buildElectionGeographyUrl('200 West 24th Street, Cheyenne, WY'); assert.equal(url.searchParams.get('vintage'),'ACS2026_Current');
 assert.deepEqual(extractElectionDistrict(match),{state:'WY',district:0});
 const result=await resolveElectionDistrict('test',{fetcher:async()=>({ok:true,json:async()=>({result:{addressMatches:[match]}})})});
 assert.equal(result.geographyEvidence.boundaryVersion,'ACS2026_Current:120th');
});
test('election geography fails closed on wrong vintage, ambiguity, and mismatched geography',async()=>{
 for(const bad of [{...match,geographies:{...match.geographies,States:[{STUSAB:'CA',GEOID:'56'}]}}, {...match,geographies:{...match.geographies,'120th Congressional Districts':undefined}}, {...match,geographies:{...match.geographies,'120th Congressional Districts':[{...match.geographies['120th Congressional Districts'][0],STATE:'06'}]}}, {...match,geographies:{...match.geographies,'120th Congressional Districts':[{...match.geographies['120th Congressional Districts'][0],CDSESSN:'119'}]}}]) assert.equal(extractElectionDistrict(bad),null);
 assert.equal(await resolveElectionDistrict('test',{fetcher:async()=>({ok:true,json:async()=>({result:{addressMatches:[match,match]}})})}),null);
 await assert.rejects(resolveElectionDistrict('test',{fetcher:async()=>({ok:false})}),/unavailable/);
});
