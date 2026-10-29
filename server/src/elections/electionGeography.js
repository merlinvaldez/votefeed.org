import { readElectionPositions, saveElectionGeography } from '../db/queries/elections.js';
import { normalizeState, ELECTION_GEOGRAPHY_SOURCE, ELECTION_GEOGRAPHY_VERSION, ELECTION_GEOGRAPHY_UNVERIFIED_STATES } from './contracts.js';

// A separate, fixed vintage keeps election geography independent of the sitting House lookup.
const ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress';
const LAYER = '120th Congressional Districts';
const STATE_FIPS = Object.freeze({AL:'01',AK:'02',AZ:'04',AR:'05',CA:'06',CO:'08',CT:'09',DE:'10',FL:'12',GA:'13',HI:'15',ID:'16',IL:'17',IN:'18',IA:'19',KS:'20',KY:'21',LA:'22',ME:'23',MD:'24',MA:'25',MI:'26',MN:'27',MS:'28',MO:'29',MT:'30',NE:'31',NV:'32',NH:'33',NJ:'34',NM:'35',NY:'36',NC:'37',ND:'38',OH:'39',OK:'40',OR:'41',PA:'42',RI:'44',SC:'45',SD:'46',TN:'47',TX:'48',UT:'49',VT:'50',VA:'51',WA:'53',WV:'54',WI:'55',WY:'56'});

export function buildElectionGeographyUrl(address) {
  if (typeof address !== 'string' || !address.trim()) throw new TypeError('Address required');
  const url = new URL(ENDPOINT);
  for (const [key,value] of Object.entries({address:address.trim(),benchmark:'Public_AR_Current',vintage:'ACS2026_Current',format:'json'})) url.searchParams.set(key,value);
  return url;
}

export function extractElectionDistrict(match) {
  const states = match?.geographies?.States;
  const districts = match?.geographies?.[LAYER];
  if (!Array.isArray(states) || states.length !== 1 || !Array.isArray(districts) || districts.length !== 1) return null;
  const state = states[0], district = districts[0];
  let abbreviation;
  try { abbreviation = normalizeState(state.STUSAB); } catch { return null; }
  const fips = String(state.STATE ?? state.GEOID ?? '');
  const geoid = String(district.GEOID ?? '');
  const code = String(district.CD120 ?? '');
  if (STATE_FIPS[abbreviation] !== fips || district.STATE !== fips || !/^\d{2}$/.test(code)
    || geoid !== `${fips}${code}` || String(district.CDSESSN) !== '120' || Number(code) > 53) return null;
  return {state:abbreviation,district:Number(code)};
}

export function extractElectionGeography(match) {
  const states = match?.geographies?.States;
  if (!Array.isArray(states) || states.length !== 1) return null;
  const state = states[0];
  let abbreviation;
  try { abbreviation = normalizeState(state.STUSAB); } catch { return null; }
  const fips = String(state.STATE ?? state.GEOID ?? '');
  if (STATE_FIPS[abbreviation] !== fips) return null;
  const district = extractElectionDistrict(match);
  const canUseDistrict = district?.state === abbreviation && !ELECTION_GEOGRAPHY_UNVERIFIED_STATES.includes(abbreviation);
  return {
    state: abbreviation,
    district: canUseDistrict ? district.district : null,
    status: canUseDistrict ? 'verified' : 'unresolved',
  };
}

export async function resolveElectionGeography(address, {fetcher=fetch, timeoutMs=15000}={}) {
  const response = await fetcher(buildElectionGeographyUrl(address),{signal:AbortSignal.timeout(timeoutMs)});
  if (!response.ok) throw new Error('Election geography service unavailable');
  const data = await response.json();
  const matches = data?.result?.addressMatches;
  if (!Array.isArray(matches) || matches.length !== 1) return null;
  const geography = extractElectionGeography(matches[0]);
  if (!geography) return null;
  return {
    ...geography,
    geographyEvidence: {
      ...geography,
      cycle: 2026,
      boundaryVersion: ELECTION_GEOGRAPHY_VERSION,
      sourceUrl: ELECTION_GEOGRAPHY_SOURCE,
      checkedAt: new Date().toISOString(),
    },
  };
}

export async function resolveElectionDistrict(address, options = {}) {
  const geography = await resolveElectionGeography(address, options);
  return geography?.status === 'verified'
    ? { state: geography.state, district: geography.district, geographyEvidence: geography.geographyEvidence }
    : null;
}

// Trusted server path: derive the district and its evidence together from one lookup.
// Do not accept a district or geography evidence ID from the caller here.
export async function readElectionPositionsForAddress(address, options = {}, auth = null, pool, lookupOptions = {}) {
  const location = await resolveElectionGeography(address, lookupOptions);
  if (!location) throw new Error('Election geography could not be verified');
  const evidence = await saveElectionGeography(location.geographyEvidence, pool);
  return readElectionPositions({state:location.state,district:location.district,
    geographyEvidenceId:location.status === 'verified' ? evidence.id : null,
    scope:options.scope,limit:options.limit,cursor:options.cursor},auth,pool);
}
