import defaultDb from '../db/client.js';
import { saveCampaignSite, startElectionRun, finishElectionRun } from '../db/queries/elections.js';
import { RELEASE_SCOPE } from './contracts.js';
import { discoveryScope, discoveryError, safeCode } from './discoveryUtils.js';
import { createCampaignSiteSearchProvider } from './campaignSiteSearch.js';

const VERSION='ai-campaign-site-discovery-v7';
const REVIEW_DAYS=7;

function approvedCampaignOrigins(siteUrl,pages=[]) {
  const initial=new URL(siteUrl);
  const alternateHost=initial.hostname.startsWith('www.') ? initial.hostname.slice(4) : `www.${initial.hostname}`;
  const alternateOrigin=`${initial.protocol}//${alternateHost}${initial.port ? `:${initial.port}` : ''}`;
  return [...new Set([initial.origin,alternateOrigin,...pages.map(page=>new URL(page.url).origin)])];
}

function evidenceFor({candidate,search,decision=null,pages=[],checkedAt,method,excerpt}) {
  return {
    url:search.siteUrl ?? search.sources?.[0]?.url ?? null,
    excerpt:excerpt ?? decision?.reason ?? search.reason ?? 'No campaign website found in web search.',
    method,
    verifierVersion:VERSION,
    checkedAt,
    model:search.model ?? null,
    promptVersions:{search:search.promptVersion ?? null,match:decision ? search.matchPromptVersion ?? null : null,
      pageSearch:search.pageSearchPromptVersion ?? null},
    candidate:{name:candidate.name,fecId:candidate.fecId,office:candidate.office,state:candidate.state,
      district:candidate.district,senateSeat:candidate.senateSeat,electionDate:candidate.electionDate},
    search:{query:search.query,sources:search.sources ?? []},
    pages:pages.map(page=>({url:page.url,retrievedAt:page.retrievedAt,title:page.title})),
    decision,
  };
}

export async function syncCampaignSiteDiscovery({
  scope=RELEASE_SCOPE,candidacyId=null,maxCandidates=20,maxPages=5,refresh=false,
  provider=null,db=defaultDb,
}={}) {
  const normScope=discoveryScope(scope);
  if (!Number.isInteger(maxCandidates) || maxCandidates<1 || maxCandidates>100) throw discoveryError('discovery-invalid-candidate-limit');
  if (typeof refresh!=='boolean') throw discoveryError('discovery-invalid-refresh');
  provider ??= createCampaignSiteSearchProvider({maxPages});
  const run=await startElectionRun({stage:'discovery',scope:normScope,adapter:'openai-web-search',adapterVersion:VERSION},db);
  const counts={candidatesConsidered:0,websitesFound:0,websitesMatched:0,websitesMissing:0,websitesAmbiguous:0,websitesRejected:0,failures:0};
  const coverage=normScope.states.flatMap(state=>normScope.offices.map(office=>({state,office,...(normScope.district!==undefined?{district:normScope.district}:{}),status:'complete',candidates:0,matched:0,missing:0,ambiguous:0,rejected:0,errorCodes:[]})));
  const codes=new Set();
  let candidates=[];
  try {
    const result=await db.query(`
      SELECT co.id AS candidacy_id,ca.name,ci.source_id AS fec_id,co.party,
        r.office,r.state,r.district,r.senate_seat,r.election_date
      FROM election_candidacies co
      JOIN election_candidates ca ON ca.id=co.candidate_id AND ca.match_status='matched'
      JOIN election_candidate_identities ci ON ci.candidate_id=ca.id AND ci.system='fec:candidate'
      JOIN election_races r ON r.id=co.race_id
      LEFT JOIN campaign_sites current_site ON current_site.candidacy_id=co.id AND current_site.is_current
      WHERE r.state=ANY($1::text[]) AND r.office=ANY($2::text[])
        AND ($5::integer IS NULL OR r.office='house' AND r.district=$5)
        AND co.eligibility NOT IN ('withdrawn','disqualified')
        AND ($3::uuid IS NULL OR co.id=$3::uuid)
        AND ($4::boolean OR current_site.id IS NULL
        OR current_site.status='verified' AND current_site.review_after<=now()
        OR current_site.status='ambiguous' AND current_site.proposed_url IS NOT NULL
          AND (current_site.review_after IS NULL OR current_site.review_after<=now()
            OR jsonb_array_length(current_site.approved_destinations)=0)
        OR current_site.status='ambiguous' AND current_site.proposed_url IS NULL
          AND current_site.checked_at<=now()-interval '7 days'
          OR current_site.status='proposed' AND current_site.invalidation_reason LIKE 'discovery-%'
        OR current_site.status NOT IN ('verified','ambiguous') AND current_site.checked_at<=now()-interval '7 days')
      ORDER BY r.state,r.office,ca.name,co.id LIMIT $6`,
    [normScope.states,normScope.offices,candidacyId,refresh,normScope.district ?? null,maxCandidates+1]);
    const hasMore=result.rows.length>maxCandidates;
    candidates=result.rows.slice(0,maxCandidates).map(row=>({...row,office:row.office,state:row.state,district:row.district,
      senateSeat:row.senate_seat,electionDate:row.election_date,fecId:row.fec_id}));
    if (hasMore) codes.add('discovery-candidate-limit');
    for (const candidate of candidates) {
      counts.candidatesConsidered++;
      const cov=coverage.find(item=>item.state===candidate.state&&item.office===candidate.office);
      if (cov) cov.candidates++;
      const checkedAt=new Date().toISOString();
      try {
        const search=await provider.search(candidate);
        search.model=provider.model ?? null;
        search.promptVersion=provider.searchPromptVersion ?? null;
        search.matchPromptVersion=provider.matchPromptVersion ?? null;
        search.pageSearchPromptVersion=provider.pageSearchPromptVersion ?? null;
        if (!search.found) {
          await saveCampaignSite({candidacyId:candidate.candidacy_id,url:null,status:'missing',checkedAt,
            invalidationReason:'no-campaign-site-found',reuseIfCurrent:false,
            evidence:evidenceFor({candidate,search,checkedAt,method:'openai-web-search-and-sitemap-or-domain-page-match-v7'})},db);
          counts.websitesMissing++;
          if (cov) cov.missing++;
          continue;
        }
        counts.websitesFound++;
        if (!search.siteUrl || !search.sourceBacked) {
          await saveCampaignSite({candidacyId:candidate.candidacy_id,url:search.siteUrl ?? null,status:'ambiguous',checkedAt,
            invalidationReason:search.siteUrl ? 'search-site-not-source-backed' : 'search-site-url-invalid',reuseIfCurrent:false,
            evidence:evidenceFor({candidate,search,checkedAt,method:'openai-web-search-and-sitemap-or-domain-page-match-v7'})},db);
          counts.websitesAmbiguous++;
          if (cov) cov.ambiguous++;
          continue;
        }
        let match;
        try { match=await provider.inspect(candidate,search.siteUrl); }
        catch (error) {
          const code=safeCode(error);
          codes.add(code); counts.failures++;
          if (cov) { cov.status='partial'; cov.errorCodes.push(code); }
          // A failed page inspection stays proposed and outside the crawl/feed path.
          await saveCampaignSite({candidacyId:candidate.candidacy_id,url:search.siteUrl,status:'proposed',checkedAt,
            invalidationReason:code,reuseIfCurrent:false,
            evidence:evidenceFor({candidate,search,checkedAt,method:'openai-web-search-and-sitemap-or-domain-page-match-v7'})},db);
          if (code==='discovery-ai-rate-limited') break;
          continue;
        }
        const status=match.status;
        const crawlEligible=['verified','ambiguous'].includes(status);
        const reviewAfter=crawlEligible ? new Date(Date.now()+REVIEW_DAYS*86400000).toISOString() : null;
        const excerpt=[match.evidence?.candidateName?.excerpt,match.evidence?.office?.excerpt,
          match.evidence?.state?.excerpt,match.evidence?.district?.excerpt].filter(Boolean).join(' | ');
        const approvedOrigins=crawlEligible ? approvedCampaignOrigins(search.siteUrl,match.evidence?.pages ?? []) : [];
        await saveCampaignSite({candidacyId:candidate.candidacy_id,url:search.siteUrl,status,
          approvedDestinations:approvedOrigins.map(origin=>({origin,pathPrefix:'/'})),
          checkedAt,reviewAfter,invalidationReason:status==='verified' ? null : status==='rejected' ? 'candidate-race-mismatch' : 'candidate-race-match-unclear',
          reuseIfCurrent:false,
          evidence:evidenceFor({candidate,search,decision:match,pages:match.evidence?.pages ?? [],checkedAt,
            method:'openai-web-search-and-sitemap-or-domain-page-match-v7',excerpt:excerpt || match.reason})},db);
        if (cov) {
          if (status==='verified') { cov.matched++; counts.websitesMatched++; }
          else if (status==='ambiguous') { cov.ambiguous++; counts.websitesAmbiguous++; }
          else { cov.rejected++; counts.websitesRejected++; }
        }
      } catch (error) {
        const code=safeCode(error);
        codes.add(code); counts.failures++;
        if (cov) { cov.status='partial'; cov.errorCodes.push(code); }
        if (code==='discovery-ai-rate-limited') break;
      }
    }
    for (const item of coverage) {
      item.errorCodes=[...new Set(item.errorCodes)];
      if (item.errorCodes.length || codes.has('discovery-candidate-limit') || codes.has('discovery-ai-rate-limited')) item.status='partial';
    }
    const status=codes.size ? 'partial' : 'complete';
    const finished=await finishElectionRun(run.id,{status,counts,coverage,errorCodes:[...codes]},db);
    return {runId:finished.id,status,counts,coverage,errorCodes:[...codes]};
  } catch (error) {
    await finishElectionRun(run.id,{status:'failed',counts,coverage,errorCodes:[safeCode(error)]},db);
    throw error;
  }
}
