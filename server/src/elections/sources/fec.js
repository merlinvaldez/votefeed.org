import { fetchPublic } from '../publicHttp.js';
import { discoveryError, campaignUrl } from '../discoveryUtils.js';

// Regular 2026 Senate contests are Class II. Special contests remain out of scope.
const CLASS_II = new Set('AL AK AR CO DE GA ID IL IA KS KY LA ME MA MI MN MS MT NE NH NJ NM NC OK OR RI SC SD TN TX VA WV WY'.split(' '));
export function fecRace(raw, {state,office}) {
  if (raw.candidate_inactive === true || raw.candidate_status === 'P') return null;
  if (office === 'senate' && !CLASS_II.has(state)) return null;
  if (office === 'house' && !/^\d{1,2}$/.test(String(raw.district ?? ''))) return null;
  return {office,state,district:office === 'house' ? Number(raw.district) : null,
    senateSeat:office === 'senate' ? 2 : null,electionDate:'2026-11-03',stage:'general',contestType:'regular'};
}

export function parseFecPage(text, {state,office,kind='candidates',page=1}) {
  let data;
  try { data = JSON.parse(text); } catch { throw discoveryError('discovery-malformed-fec'); }
  const p = data.pagination;
  if (!Array.isArray(data.results) || !p || p.page !== page || !Number.isInteger(p.pages) || p.pages < 0
    || !Number.isInteger(p.count) || p.count < 0 || !Number.isInteger(p.per_page) || p.per_page < 1
    || data.results.length > p.per_page || p.pages && page > p.pages
    || p.count && !data.results.length) throw discoveryError('discovery-malformed-fec');
  const invalidRecords = [];
  const records = data.results.map(raw => {
    if (kind === 'committees') {
      if (!/^C\d{8}$/.test(raw.committee_id) || !Array.isArray(raw.candidate_ids)) throw discoveryError('discovery-malformed-fec');
      return raw;
    }
    if (!/^[HS]\d[A-Z]{2}\d{5}$/.test(raw.candidate_id) || raw.state !== state
      || raw.office !== (office === 'house' ? 'H' : 'S') || !raw.election_years?.includes(2026)) throw discoveryError('discovery-malformed-fec');
    if (typeof raw.name !== 'string' || !raw.name.trim()) {
      invalidRecords.push({kind:'fec',fecId:raw.candidate_id,name:null,race:fecRace(raw,{state,office}),raw,reason:'missing-name'}); return null;
    }
    return {kind:'fec',name:raw.name,party:raw.party ?? null,fecId:raw.candidate_id,officialId:null,race:fecRace(raw,{state,office}),
      eligibility:'unknown',siteUrl:null,excerpt:JSON.stringify(raw),locator:raw.candidate_id,raw};
  }).filter(Boolean);
  return {records,invalidRecords,pagination:p};
}
export async function* fecPages({state,office,apiKey,kind='candidates',candidateId,maxPages=100,fetcher=fetchPublic,capture}) {
  if (!apiKey) throw discoveryError('discovery-fec-key-missing');
  if (!Number.isInteger(maxPages) || maxPages<1 || maxPages>1000) throw discoveryError('discovery-invalid-page-limit');
  const seen = new Set(); let expected = null, read = 0;
  for (let page=1;page<=maxPages;page++) {
    const url = new URL(kind === 'committees' ? `https://api.open.fec.gov/v1/candidate/${candidateId}/committees/` : 'https://api.open.fec.gov/v1/candidates/search/');
    for (const [key,value] of Object.entries(kind === 'committees'
      ? {cycle:2026,per_page:100,page} : {election_year:2026,state,office:office === 'house' ? 'H' : 'S',per_page:100,page,sort:'candidate_id'})) url.searchParams.set(key,value);
    const response = await fetcher(url.href,{allowedOrigins:['https://api.open.fec.gov'],headers:{'X-Api-Key':apiKey}});
    const text = response.bytes.toString('utf8');
    // Capture even malformed/provider-error bodies before attempting extraction.
    const document = await capture(response,{kind,page,text});
    const result = parseFecPage(text,{state,office,kind,page});
    if (expected && (result.pagination.count !== expected.count || result.pagination.pages !== expected.pages)) throw discoveryError('discovery-fec-pagination-changed');
    expected ??= result.pagination;
    for (const row of [...result.records,...result.invalidRecords]) {
      const id = kind === 'committees' ? row.committee_id : row.fecId;
      if (seen.has(id)) throw discoveryError('discovery-fec-pagination-duplicate');
      seen.add(id); read++;
    }
    yield {document,...result,page};
    if (page >= result.pagination.pages) {
      if (read !== expected.count) throw discoveryError('discovery-fec-count-mismatch');
      return;
    }
  }
  throw discoveryError('discovery-fec-page-limit');
}
export function committeeWebsiteProposals(records, candidateId) {
  return records.filter(r=>r.candidate_ids.includes(candidateId) && ['P','A'].includes(r.designation))
    .map(r=>({committeeId:r.committee_id,candidateId,url:campaignUrl(r.website),raw:r}));
}
