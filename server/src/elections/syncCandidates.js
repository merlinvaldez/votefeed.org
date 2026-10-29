import db from '../db/client.js';
import * as storage from '../db/queries/electionDiscovery.js';
import { startElectionRun, finishElectionRun, saveCampaignSite } from '../db/queries/elections.js';
import { fetchPublic } from './publicHttp.js';
import { discoveryScope, DISCOVERY_VERSION, discoveryError, safeCode } from './discoveryUtils.js';
import { fecPages, committeeWebsiteProposals } from './sources/fec.js';
import { verifyCampaignDestination } from './verifyCampaignSite.js';

export async function syncCandidates({scope:inputScope,fecApiKey=null,
  verifySites=false,discoverCommittees=true,maxPages=100,maxCommittees=1000,fecIntervalMs=1200,fetcher=fetchPublic,pool=db} = {}) {
  const scope = discoveryScope(inputScope);
  if (typeof discoverCommittees !== 'boolean') throw discoveryError('discovery-invalid-committee-mode');
  if (!Number.isInteger(maxCommittees) || maxCommittees<0 || maxCommittees>1000) throw discoveryError('discovery-invalid-committee-limit');
  if (!Number.isInteger(fecIntervalMs) || fecIntervalMs<0 || fecIntervalMs>60000) throw discoveryError('discovery-invalid-rate');
  let nextFecRequestAt = 0, quotaExceeded = false;
  const fecFetcher = async (...args) => {
    const wait = nextFecRequestAt - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    nextFecRequestAt = Date.now() + fecIntervalMs;
    return fetcher(...args);
  };
  const markRateLimit = error => { if (['discovery-rate-limited','discovery-retry-deferred'].includes(error.code)) quotaExceeded = true; };
  const run = await startElectionRun({stage:'discovery',scope,adapter:'public-evidence',adapterVersion:DISCOVERY_VERSION},pool);
  const counts = {documents:0,observations:0,promoted:0,unresolved:0,invalidRecords:0,sitesVerified:0};
  const coverage = scope.states.flatMap(state=>scope.offices.map(office=>({state,office,...(scope.district!==undefined?{district:scope.district}:{}),status:'unsupported',fecStatus:'pending',raceResults:[],sourceResults:[],errorCodes:[],warningCodes:[]})));
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
      if (observation.validation.outcome !== 'valid') { counts.invalidRecords++; continue; }
      let resolution;
      try { resolution = await storage.promoteElectionObservation(observation.id,{},pool); counts.promoted++; }
      catch (error) {
        if (!['discovery-ambiguous-match','discovery-match-review-required','discovery-identity-conflict'].includes(error.code)) throw error;
        counts.unresolved++; errorCodes.add(safeCode(error)); continue;
      }
      if (discoverCommittees && resolution.candidacy_id) {
        const savedObservation = await storage.readDiscoveryObservation(observation.id,pool);
        const existing = (await pool.query('SELECT * FROM campaign_sites WHERE candidacy_id=$1 AND is_current',[resolution.candidacy_id])).rows[0];
        // A candidate record has no committee website; do not erase prior committee evidence.
        if (!observation.data.committeeId && existing) continue;
        let site;
        if (verifySites) site = await verifyCampaignDestination({observation:savedObservation,resolution,fetcher});
        else site = {candidacyId:resolution.candidacy_id,url:observation.data.siteUrl ?? observation.data.siteRaw ?? null,
          status:observation.data.siteUrl ? 'proposed' : observation.data.siteRaw ? 'rejected' : 'missing',
          checkedAt:new Date().toISOString(),evidence:{url:doc.final_url,excerpt:observation.data.excerpt,recordKey:observation.record_key,observationId:observation.id},reuseIfCurrent:true};
        const current = existing;
        // Ordinary discovery and transient network failures do not demote a current crawl-eligible site.
        const currentIsFresh = current?.proposed_url === site.url && new Date(current.review_after)>new Date();
        const keepAmbiguous = current?.status==='ambiguous' && currentIsFresh && site.status!=='verified';
        const keepVerified = current?.status==='verified' && currentIsFresh
          && (current.evidence.recordKey === observation.record_key && !verifySites
            || site.invalidationReason?.startsWith('discovery-') && site.status === 'proposed');
        const keep = keepAmbiguous || keepVerified;
        if (!keep) { const saved = await saveCampaignSite(site,pool); if (saved.status === 'verified') counts.sitesVerified++; }
      }
    }
  };
  try {
    for (const entry of coverage) {
      if (quotaExceeded) { entry.status='failed'; entry.fecStatus='failed'; entry.errorCodes.push('discovery-rate-limited'); continue; }
      let candidateCount = 0, invalidCandidateCount = 0, committeeCount = 0;
      const unresolvedBefore = counts.unresolved;
      const capture = async (response,{kind,page,text},candidateId=null) => document(response,{
        sourceKey:`fec:${entry.state}:${entry.office}:${scope.district==null?'':`district-${scope.district}:`}${kind}:${candidateId ?? 'all'}:${page}`,system:'fec:discovery',text,
        context:{scope,state:entry.state,office:entry.office,...(scope.district!==undefined?{district:scope.district}:{}),kind,authoritative:false},
      });
      try {
        for await (const page of fecPages({...entry,apiKey:fecApiKey,maxPages,fetcher:fecFetcher,capture})) {
          candidateCount += page.records.length + page.invalidRecords.length;
          if (page.invalidRecords.length) {
            invalidCandidateCount += page.invalidRecords.length;
            entry.warningCodes.push('discovery-fec-invalid-record');
            await persist(page.document,page.invalidRecords.map(data=>({data,validation:{outcome:'invalid',errors:[data.reason],validatorVersion:'fec-v1'}})),
              {extractor:'openfec',promptVersion:'none',outcome:'partial'});
          }
          await persist(page.document,page.records.map(data=>({data,validation:{outcome:'valid',errors:[],validatorVersion:'fec-v1'}})),
            {extractor:'openfec',promptVersion:'none',outcome:'valid'});
          if (discoverCommittees) for (const candidate of [...page.invalidRecords,...page.records]) {
            // Keep incomplete FEC records and their committee links for review.
            if (!candidate.race && !candidate.reason) continue;
            if (committeeCount >= maxCommittees) { entry.errorCodes.push('discovery-committee-limit'); continue; }
            committeeCount++;
            try {
              for await (const committees of fecPages({...entry,apiKey:fecApiKey,kind:'committees',candidateId:candidate.fecId,maxPages,fetcher:fecFetcher,
                capture:(response,meta)=>capture(response,meta,candidate.fecId)})) {
                for (const proposal of committeeWebsiteProposals(committees.records,candidate.fecId)) {
                  const data = {...candidate,siteUrl:proposal.url,siteRaw:proposal.raw.website,
                    committeeId:proposal.committeeId,excerpt:JSON.stringify(proposal.raw)};
                  const invalid = candidate.reason === 'missing-name';
                  await persist(committees.document,[{data,validation:{outcome:invalid ? 'invalid' : 'valid',errors:invalid ? ['missing-name'] : [],validatorVersion:'fec-committee-v2'}}],
                    {extractor:'openfec-committees',promptVersion:'none',outcome:invalid ? 'partial' : 'valid'});
                }
              }
            } catch (error) { entry.errorCodes.push(safeCode(error)); markRateLimit(error); }
            if (quotaExceeded) break;
          }
          if (quotaExceeded) break;
        }
        entry.fecStatus = entry.errorCodes.length ? 'partial' : 'complete';
      } catch (error) { entry.fecStatus = candidateCount ? 'partial' : 'failed'; entry.errorCodes.push(safeCode(error)); markRateLimit(error); }
      if (counts.unresolved > unresolvedBefore) {
        entry.errorCodes.push('discovery-unresolved-records');
        if (entry.fecStatus === 'complete') entry.fecStatus = 'partial';
      }
      entry.status = entry.fecStatus;
      entry.fecCandidates = candidateCount;
      entry.invalidFecCandidates = invalidCandidateCount;
    }
    for (const entry of coverage) {
      entry.errorCodes = [...new Set(entry.errorCodes)];
      entry.warningCodes = [...new Set(entry.warningCodes)];
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
