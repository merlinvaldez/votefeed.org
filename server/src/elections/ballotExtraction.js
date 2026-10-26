import { parse } from 'csv-parse/sync';
import { load } from 'cheerio';
import { normalizeRace, isReleaseRace, raceKey } from './contracts.js';
import { campaignUrl, discoveryError, publicUrl, stableJson } from './discoveryUtils.js';

export function validateSource(source, scope) {
  if (!source?.id || !scope.states.includes(source.state) || !source.authoritative || !source.authorityUrl
    || !Array.isArray(source.races) || !source.races.length && !source.noRaces?.length || !source.checkedAt
    || !Number.isFinite(Date.parse(source.checkedAt)) || !['partial','complete'].includes(source.completeness)) throw discoveryError('discovery-source-review-required');
  publicUrl(source.authorityUrl);
  const target = publicUrl(source.url);
  if (!source.allowedOrigins?.includes(target.origin)) throw discoveryError('discovery-source-origin-required');
  for (const {race,label} of source.races) {
    if (!label || !isReleaseRace(race) || race.state !== source.state) throw discoveryError('discovery-invalid-source-race');
  }
  for (const proof of source.noRaces ?? []) {
    if (!['house','senate'].includes(proof.office) || !proof.excerpt || !proof.reviewedBy || !proof.checkedAt
      || source.races.some(r=>r.race.office === proof.office)) throw discoveryError('discovery-invalid-no-race-proof');
  }
  if(source.format==='mapped-csv' && (!source.csv?.columns?.name || !source.csv.columns.office
    || !source.csv.filter?.column || !source.csv.filter.value || !source.csv.statuses
    || !Object.values(source.csv.statuses).every(s=>['ballot-confirmed','withdrawn','disqualified','unknown'].includes(s)))) {
    throw discoveryError('discovery-csv-mapping-required');
  }
  return source;
}
export async function documentText(bytes, mediaType, format) {
  if (bytes.subarray(0,5).toString() === '%PDF-') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false});
    try {
      const info = await parser.getInfo();
      if (info.total > 100) throw discoveryError('discovery-document-page-limit');
      return (await parser.getText()).text;
    } finally { await parser.destroy(); }
  }
  const text = bytes.toString('utf8');
  if (['wy-csv','mapped-csv'].includes(format) || /csv|json|text\/plain/.test(mediaType)) return text;
  if (/html/.test(mediaType)) {
    const $ = load(text); $('script,style,nav,footer,header,noscript,iframe').remove();
    $('br').replaceWith('\n'); $('p,tr,h1,h2,h3,h4,li,section').append('\n');
    return $('body').text().split('\n').map(s=>s.trim()).filter(Boolean).join('\n');
  }
  throw discoveryError('discovery-unsupported-document');
}
function isoDate(value) {
  if (!value) return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) throw discoveryError('discovery-invalid-source-date');
  const date = `${match[3]}-${match[1]}-${match[2]}`;
  if (new Date(date).toISOString().slice(0,10) !== date) throw discoveryError('discovery-invalid-source-date');
  return date;
}
export function extractWyoming(text, source, scope) {
  const columns = ['Election','Office Sought','Party Affiliation','Ballot Name','Web Address','Date Filed','Date Withdrawn'];
  let entries;
  try {
    entries = parse(text,{columns:header=>{
      if (columns.some(c=>!header.includes(c)) || new Set(header).size !== header.length) throw discoveryError('discovery-malformed-csv');
      return header;
    },bom:true,raw:true,skip_empty_lines:true,record_delimiter:['\r\r\n','\r\n','\n','\r'],max_record_size:20000});
  } catch { throw discoveryError('discovery-malformed-csv'); }
  const rows = [];
  for (const [index,entry] of entries.entries()) {
    const raw = entry.record;
    if (raw.Election !== '2026 GENERAL ELECTION') continue;
    const spec = source.races.find(r=>r.label === raw['Office Sought']);
    if (!spec || !scope.offices.includes(spec.race.office)) continue;
    const withdrawnAt = isoDate(raw['Date Withdrawn']); isoDate(raw['Date Filed']);
    rows.push({kind:'ballot',name:raw['Ballot Name'],party:raw['Party Affiliation'] || null,
      race:normalizeRace(spec.race),officialId:null,fecId:null,siteUrl:campaignUrl(raw['Web Address']),
      eligibility:withdrawnAt ? 'withdrawn' : 'ballot-confirmed',withdrawnAt,reinstated:false,
      excerpt:entry.raw,locator:`data-row:${index+1}`,raw});
  }
  if (!rows.length) throw discoveryError('discovery-empty-unconfirmed');
  return rows;
}

export function extractMappedCsv(text,source,scope) {
  validateSource(source,scope);
  const {columns,filter,statuses,delimiter=','}=source.csv;
  const required=[...Object.values(columns),filter.column];
  let entries;
  try { entries=parse(text,{delimiter,columns:header=>{
    if(required.some(c=>!header.includes(c)) || new Set(header).size!==header.length) throw new Error();
    return header;
  },bom:true,raw:true,skip_empty_lines:true,max_record_size:20000}); }
  catch { throw discoveryError('discovery-malformed-csv'); }
  const rows=[];
  for(const [index,entry] of entries.entries()) {
    const raw=entry.record;
    if(raw[filter.column]!==filter.value) continue;
    const spec=source.races.find(r=>r.label===raw[columns.office]);
    if(!spec || !scope.offices.includes(spec.race.office)) continue;
    const status=columns.status ? raw[columns.status] : '';
    rows.push({name:raw[columns.name],party:raw[columns.party]||null,race:normalizeRace(spec.race),
      officialId:raw[columns.officialId]||null,fecId:raw[columns.fecId]||null,
      website:raw[columns.website]||null,eligibility:statuses[status]??'unknown',excerpt:entry.raw,
      locator:`data-row:${index+1}`,raw});
  }
  if(!rows.length) throw discoveryError('discovery-empty-unconfirmed');
  return rows;
}

export function validateBallotRows(rows, text, source, scope, semantic = null) {
  if (!Array.isArray(rows) || rows.length > 2000) throw discoveryError('discovery-malformed-extraction');
  const seen = new Set(), names = new Map();
  const records = rows.map(input => {
    const errors = []; let race = null;
    const spec = source.races.find(s=>s.label === input.raceLabel || stableJson(s.race) === stableJson(input.race));
    try {
      race = normalizeRace(spec?.race ?? input.race);
      if (!isReleaseRace(race) || race.state !== source.state || !scope.offices.includes(race.office)) errors.push('scope');
    } catch { errors.push('race'); }
    const excerpt = input.excerpt;
    if (typeof excerpt !== 'string' || !excerpt.trim() || excerpt.length > 20000 || !text.includes(excerpt)) errors.push('excerpt');
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 300 || !excerpt?.includes(input.name)) errors.push('name');
    if (input.party && (typeof input.party !== 'string' || !excerpt?.includes(input.party))) errors.push('party');
    if (!['ballot-confirmed','withdrawn','disqualified','unknown'].includes(input.eligibility)) errors.push('eligibility');
    if (input.fecId && (!/^[HS]\d[A-Z]{2}\d{5}$/.test(input.fecId) || !excerpt?.includes(input.fecId))) errors.push('fec-id');
    if (input.officialId && !excerpt?.includes(input.officialId)) errors.push('official-id');
    const siteUrl = campaignUrl(input.siteUrl ?? input.website);
    const rawSite = input.raw?.['Web Address'] ?? input.siteRaw ?? input.website ?? input.siteUrl;
    if (rawSite && !excerpt?.includes(rawSite)) errors.push('website');
    if (input.eligibility === 'withdrawn' && !(source.format === 'wy-csv' && input.withdrawnAt)
      && !/withdrawn|withdrawal/i.test(excerpt ?? '')) errors.push('withdrawal-evidence');
    if (input.eligibility === 'disqualified' && !/disqualified|disqualification/i.test(excerpt ?? '')) errors.push('disqualification-evidence');
    if (typeof input.locator !== 'string' || !input.locator.trim()) errors.push('locator');
    const data = {kind:'ballot',name:input.name ?? '',party:input.party ?? null,race,
      officialId:input.officialId ?? null,fecId:input.fecId ?? null,siteUrl,
      siteRaw:rawSite ?? null,siteIssue:rawSite && !siteUrl ? 'invalid-url' : null,
      eligibility:input.eligibility ?? 'unknown',reinstated:false,excerpt:excerpt ?? '',locator:input.locator ?? '',raw:input.raw ?? null};
    // AI cannot declare itself validated. A separate verification call must agree.
    const reviewed = ['wy-csv','mapped-csv'].includes(source.format) || Array.isArray(semantic) && semantic.some(v=>v.locator === data.locator && v.supported === true);
    const review = !reviewed || !spec || data.eligibility === 'unknown';
    const key = stableJson(data);
    if (seen.has(key)) errors.push('duplicate'); seen.add(key);
    const nameKey = race ? `${raceKey(race)}:${data.name.toLowerCase()}` : data.name;
    names.set(nameKey,(names.get(nameKey) ?? 0)+1);
    return {data,validation:{outcome:errors.length ? 'invalid' : review ? 'needs-review' : 'valid',errors,validatorVersion:'ballot-validator-v1'},nameKey};
  });
  for (const record of records) {
    if (names.get(record.nameKey)>1 && record.validation.outcome === 'valid') record.validation = {...record.validation,outcome:'needs-review',errors:['ambiguous-rows']};
    delete record.nameKey;
  }
  return records;
}
