import db from '../db/client.js';
import * as storage from '../db/queries/electionDiscovery.js';
import { startElectionRun, finishElectionRun, saveCampaignSite } from '../db/queries/elections.js';
import { fetchPublic } from './publicHttp.js';
import { discoveryScope, DISCOVERY_VERSION, discoveryError, safeCode } from './discoveryUtils.js';
import { fecPages, committeeWebsiteProposals } from './sources/fec.js';
import { verifyCampaignDestination } from './verifyCampaignSite.js';

export async function syncCandidates({scope:inputScope,fecApiKey=null,
  verifySites=false,maxPages=100,maxCommittees=100,fetcher=fetchPublic,pool=db} = {}) {
  const scope = discoveryScope(inputScope);
  if (!Number.isInteger(maxCommittees) || maxCommittees<0 || maxCommittees>1000) throw discoveryError('discovery-invalid-committee-limit');
  const run = await startElectionRun({stage:'discovery',scope,adapter:'public-evidence',adapterVersion:DISCOVERY_VERSION},pool);
  const counts = {documents:0,observations:0,promoted:0,unresolved:0,sitesVerified:0};
  const coverage = scope.states.flatMap(state=>scope.offices.map(office=>({state,office,status:'unsupported',fecStatus:'pending',raceResults:[],sourceResults:[],errorCodes:[]})));
  const errorCodes = new Set();
  const document = async (response,input) => {
    const saved = await storage.saveElectionDocument({...input,bytes:response.bytes,requestedUrl:response.requestedUrl,
      finalUrl:response.finalUrl,retrievedAt:response.retrievedAt,mediaType:response.headers['content-type'] ?? 'application/octet-stream'},pool);
    counts.documents++; return saved;
  };
  const persist = async (doc,records,details) => {
    const observations = await storage.saveElectionExtraction({documentId:doc.id,runId:run.id,...details,records},pool);
    counts.observations += observations.length;
    for (const observation of observations) {
      if (observation.validation.outcome !== 'valid') { counts.unresolved++; continue; }
      let resolution;
      try { resolution = await storage.promoteElectionObservation(observation.id,{},pool); counts.promoted++; }
      catch (error) {
        if (!['discovery-ambiguous-match','discovery-match-review-required','discovery-identity-conflict'].includes(error.code)) throw error;
        counts.unresolved++; errorCodes.add(safeCode(error)); continue;
      }
      if (resolution.candidacy_id) {
        const savedObservation = await storage.readDiscoveryObservation(observation.id,pool);
        let site;
        if (verifySites) site = await verifyCampaignDestination({observation:savedObservation,resolution,fetcher});
        else site = {candidacyId:resolution.candidacy_id,url:observation.data.siteUrl ?? observation.data.siteRaw ?? null,
          status:observation.data.siteUrl ? 'proposed' : observation.data.siteRaw ? 'rejected' : 'missing',
          checkedAt:new Date().toISOString(),evidence:{url:doc.final_url,excerpt:observation.data.excerpt,recordKey:observation.record_key,observationId:observation.id},reuseIfCurrent:true};
        const current = (await pool.query('SELECT * FROM campaign_sites WHERE candidacy_id=$1 AND is_current',[resolution.candidacy_id])).rows[0];
        // Ordinary discovery and transient network failures do not demote a still-current verified site.
        const keep = current?.status === 'verified' && current.proposed_url === site.url && new Date(current.review_after)>new Date()
          && (current.evidence.recordKey === observation.record_key && !verifySites
            || site.invalidationReason?.startsWith('discovery-') && site.status === 'proposed');
        if (!keep) { const saved = await saveCampaignSite(site,pool); if (saved.status === 'verified') counts.sitesVerified++; }
      }
    }
  };
  try {
    for (const entry of coverage) {
      let candidateCount = 0, committeeCount = 0;
      const capture = async (response,{kind,page,text},candidateId=null) => document(response,{
        sourceKey:`fec:${entry.state}:${entry.office}:${kind}:${candidateId ?? 'all'}:${page}`,system:'fec:discovery',text,
        context:{scope,state:entry.state,office:entry.office,kind,authoritative:false},
      });
      try {
        for await (const page of fecPages({...entry,apiKey:fecApiKey,maxPages,fetcher,capture})) {
          candidateCount += page.records.length;
          await persist(page.document,page.records.map(data=>({data,validation:{outcome:'valid',errors:[],validatorVersion:'fec-v1'}})),
            {extractor:'openfec',promptVersion:'none',outcome:'valid'});
          for (const candidate of page.records) {
            if (committeeCount >= maxCommittees) { entry.errorCodes.push('discovery-committee-limit'); continue; }
            committeeCount++;
            try {
              for await (const committees of fecPages({...entry,apiKey:fecApiKey,kind:'committees',candidateId:candidate.fecId,maxPages,fetcher,
                capture:(response,meta)=>capture(response,meta,candidate.fecId)})) {
                for (const proposal of committeeWebsiteProposals(committees.records,candidate.fecId)) {
                  const data = {...candidate,siteUrl:proposal.url,siteRaw:proposal.raw.website,
                    committeeId:proposal.committeeId,excerpt:JSON.stringify(proposal.raw)};
                  await persist(committees.document,[{data,validation:{outcome:'valid',errors:[],validatorVersion:'fec-committee-v2'}}],
                    {extractor:'openfec-committees',promptVersion:'none',outcome:'valid'});
                }
              }
            } catch (error) { entry.errorCodes.push(safeCode(error)); }
          }
        }
        entry.fecStatus = entry.errorCodes.length ? 'partial' : 'complete';
      } catch (error) { entry.fecStatus = candidateCount ? 'partial' : 'failed'; entry.errorCodes.push(safeCode(error)); }
      entry.fecCandidates = candidateCount;
    }
    for (const entry of coverage) {
      entry.errorCodes = [...new Set(entry.errorCodes)];
      for (const code of entry.errorCodes) errorCodes.add(code);
    }
    const status = coverage.every(e=>e.fecStatus === 'complete') ? 'complete'
      : coverage.some(e=>['complete','partial'].includes(e.fecStatus)) ? 'partial' : 'failed';
    await finishElectionRun(run.id,{status,counts,coverage,errorCodes:[...errorCodes]},pool);
    return {runId:run.id,status,counts,coverage,errorCodes:[...errorCodes]};
  } catch (error) {
    await finishElectionRun(run.id,{status:'failed',counts,coverage,errorCodes:[safeCode(error)]},pool);
    throw error;
  }
}
