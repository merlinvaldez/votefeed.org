import test from 'node:test';
import assert from 'node:assert/strict';
import { buildElectionGeographyUrl, extractElectionDistrict } from '../server/src/elections/electionGeography.js';

test('live Census 120th election geography agrees with TIGERweb', {skip:process.env.ELECTIONS_LIVE_GEOGRAPHY!=='1',timeout:120000},async()=>{
 for(const sample of [
   {address:'200 W 24th St, Cheyenne, WY 82001',state:'WY',district:0},
   {address:'1315 10th St, Sacramento, CA 95814',state:'CA',district:7},
   {address:'1100 Congress Ave, Austin, TX 78701',state:'TX',district:10},
 ]) {
   const response=await fetch(buildElectionGeographyUrl(sample.address),{signal:AbortSignal.timeout(30000)}); assert.ok(response.ok);
   const match=(await response.json()).result.addressMatches[0];
   assert.deepEqual(extractElectionDistrict(match),{state:sample.state,district:sample.district});
   const url=new URL('https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0/query');
   for(const [key,value] of Object.entries({geometry:`${match.coordinates.x},${match.coordinates.y}`,geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'STATE,CD120,GEOID',returnGeometry:'false',f:'json'})) url.searchParams.set(key,value);
   const map=await fetch(url,{signal:AbortSignal.timeout(30000)});assert.ok(map.ok);const result=await map.json();
   assert.equal(result.features.length,1); assert.equal(result.features[0].attributes.GEOID,match.geographies['120th Congressional Districts'][0].GEOID);
   console.log(JSON.stringify({state:sample.state,district:sample.district,geoid:result.features[0].attributes.GEOID}));
 }
});
