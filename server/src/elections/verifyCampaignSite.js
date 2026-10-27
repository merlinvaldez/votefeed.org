import { cleanCampaignHtml } from './cleanCampaignHtml.js';
import { fetchPublic, resolvePublic } from './publicHttp.js';
import { campaignUrl, publicUrl, safeCode } from './discoveryUtils.js';

const normalize = text => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const vendors = ['facebook.com','instagram.com','x.com','twitter.com','youtube.com','tiktok.com','actblue.com','winred.com','anedot.com','donorbox.org','paypal.com','linktr.ee'];
export async function verifyCampaignDestination({observation,resolution,fetcher=fetchPublic,checkedAt=new Date().toISOString(),reviewDays=7}) {
  const row = observation.data;
  const evidence = {url:observation.final_url,excerpt:row.excerpt,observationId:observation.id,
    recordKey:observation.record_key,method:'fec-committee-link-and-page',verifierVersion:'site-verifier-v1'};
  const url = campaignUrl(row.siteUrl);
  const base = {candidacyId:resolution.candidacy_id,url:url ?? row.siteRaw ?? null,status:url ? 'proposed' : row.siteRaw ? 'rejected' : 'missing',
    evidence,checkedAt,reuseIfCurrent:true,...(!url && row.siteRaw ? {invalidationReason:'invalid-site-url'} : {})};
  if (!url) return base;
  if (!Number.isInteger(reviewDays) || reviewDays<1 || reviewDays>30) throw new TypeError('reviewDays must be 1-30');
  const target = publicUrl(url);
  if (vendors.some(domain=>target.hostname === domain || target.hostname.endsWith(`.${domain}`))) return {...base,status:'rejected',invalidationReason:'unrelated-platform'};
  const ownership = row.kind === 'fec' && observation.system === 'fec:discovery' && row.committeeId
      && row.raw?.candidate_id === row.fecId;
  if (!ownership || observation.validation.outcome !== 'valid' || !row.race || !resolution.candidacy_id) return base;
  try {
    const page = await fetcher(url,{allowedOrigins:[target.origin],maxBytes:1_000_000});
    const type = page.headers['content-type'] ?? '';
    if (!type.includes('text/html')) return {...base,invalidationReason:'unsupported-site-content'};
    const text = normalize(cleanCampaignHtml(page.bytes.toString('utf8')));
    const name = normalize(row.name);
    const office = row.race.office === 'senate' ? /\bsenat(?:e|or)\b/ : /\bcongress(?:ional)?\b|\bu s house\b|\bunited states house\b/;
    if (!text.includes(name) || !office.test(text)) return {...base,status:'ambiguous',invalidationReason:'candidate-race-not-supported'};
    return {...base,status:'verified',approvedDestinations:[{origin:target.origin,pathPrefix:target.pathname.endsWith('/') ? target.pathname : target.pathname || '/'}],
      reviewAfter:new Date(new Date(checkedAt).getTime()+reviewDays*86400000).toISOString()};
  } catch (error) { return {...base,invalidationReason:safeCode(error)}; }
}

// Exported for tools that need to inspect a proposed origin without fetching it.
export { resolvePublic };
