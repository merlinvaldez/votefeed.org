import db from '../db/client.js';
import * as storage from '../db/queries/electionDiscovery.js';
import { startElectionRun, finishElectionRun, saveCampaignSite } from '../db/queries/elections.js';
import { fetchPublic } from './publicHttp.js';
import { discoveryScope, DISCOVERY_VERSION, discoveryError, safeCode } from './discoveryUtils.js';
import { validateSource, documentText, extractWyoming, extractMappedCsv, validateBallotRows } from './ballotExtraction.js';
import { fecPages, committeeWebsiteProposals } from './sources/fec.js';
import { verifyCampaignDestination } from './verifyCampaignSite.js';

export async function syncCandidates({scope:inputScope,sources=[],provider=null,fecApiKey=null,includeFec=true,
  verifySites=false,maxPages=100,maxCommittees=100,fetcher=fetchPublic,pool=db} = {}) {
  const scope = discoveryScope(inputScope);
  if (!Number.isInteger(maxCommittees) || maxCommittees<0 || maxCommittees>1000) throw discoveryError('discovery-invalid-committee-limit');
  const selected = sources.filter(s=>scope.states.includes(s.state));
  for (const source of selected) validateSource(source,scope);
  const run = await startElectionRun({stage:'discovery',scope,adapter:'public-evidence',adapterVersion:DISCOVERY_VERSION},pool);
  const counts = {documents:0,observations:0,promoted:0,unresolved:0,sitesVerified:0};
  const coverage = scope.states.flatMap(state=>scope.offices.map(office=>({state,office,status:'unsupported',fecStatus:includeFec ? 'pending' : 'skipped',raceResults:[],sourceResults:[],errorCodes:[]})));
  const entryFor = (state,office) => coverage.find(e=>e.state === state && e.office === office);
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
    if (includeFec) for (const entry of coverage) {
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
    for (const source of selected) {
      const offices = [...new Set([...source.races.map(r=>r.race.office),...(source.noRaces ?? []).map(r=>r.office)])].filter(o=>scope.offices.includes(o));
      if (!offices.length) continue;
      let doc;
      try {
        const response = await fetcher(source.url,{allowedOrigins:source.allowedOrigins});
        // Persist the original bytes first, even if PDF/HTML parsing later fails.
        doc = await document(response,{sourceKey:source.id,system:`state:${source.state}:ballot`,text:'',effectiveAt:source.effectiveAt,
          context:{scope,source,authoritative:true,representation:'raw'}});
        const text = await documentText(response.bytes,response.headers['content-type'] ?? '',source.format);
        if (!text.trim() || text.length>300000) throw discoveryError('discovery-document-text-limit');
        doc = await document(response,{sourceKey:source.id,system:`state:${source.state}:ballot`,text,effectiveAt:source.effectiveAt,
          context:{scope,source,authoritative:true,representation:'extracted-text'}});
        let rows, semantic = null;
        if (!source.races.some(r=>scope.offices.includes(r.race.office))) rows = [];
        else if (source.format === 'wy-csv') rows = extractWyoming(text,source,scope);
        else if (source.format === 'mapped-csv') rows = extractMappedCsv(text,source,scope);
        else {
          if (!provider) throw discoveryError('discovery-ai-provider-required');
          rows = await provider.extract({text,source});
          semantic = await provider.verify({text,source,rows});
        }
        const records = validateBallotRows(rows,text,source,scope,semantic);
        const valid = records.filter(r=>r.validation.outcome === 'valid').length;
        const promotedBefore = counts.promoted;
        await persist(doc,records,{extractor:['wy-csv','mapped-csv'].includes(source.format) ? `${source.format}-v1` : !rows.length && source.noRaces?.length ? 'official-no-race-proof' : 'ai-ballot-v1',
          model:['wy-csv','mapped-csv'].includes(source.format) ? null : provider?.model ?? null,
          promptVersion:['wy-csv','mapped-csv'].includes(source.format) ? 'none' : provider?.promptVersion ?? 'none',outcome:records.length && valid === records.length ? 'valid' : 'partial'});
        for (const office of offices) {
          const entry = entryFor(source.state,office);
          const rowCount = records.filter(r=>r.data.race?.office === office).length;
          const noRace = (source.noRaces ?? []).some(proof=>proof.office === office && text.includes(proof.excerpt));
          const complete = source.completeness === 'complete' && source.coverageAccepted === true
            && source.correctionsAudited === true && valid === records.length
            && (rowCount>0 || noRace) && counts.promoted-promotedBefore === valid;
          const status = complete ? 'complete' : 'partial';
          entry.sourceResults.push({sourceId:source.id,status,records:rowCount});
          // Empty AI output never proves no race. Completeness requires reviewed
          // race coverage and corrections, not the model's self-assessment.
          entry.status = entry.sourceResults.every(s=>s.status === 'complete') ? 'complete' : 'partial';
          if (noRace && complete) entry.noRaces = true;
          entry.raceResults.push(...source.races.filter(r=>r.race.office === office).map(r=>({race:r.race,status})));
        }
      } catch (error) {
        const code = safeCode(error); errorCodes.add(code);
        if (doc) await storage.saveElectionExtraction({documentId:doc.id,runId:run.id,extractor:source.format,promptVersion:provider?.promptVersion ?? 'none',outcome:'failed',errorCode:code},pool);
        for (const office of offices) {
          const entry = entryFor(source.state,office);
          entry.sourceResults.push({sourceId:source.id,status:'failed',records:0});
          entry.status = entry.sourceResults.some(s=>s.status === 'partial') ? 'partial' : 'failed'; entry.errorCodes.push(code);
        }
      }
    }
    for (const entry of coverage) {
      entry.errorCodes = [...new Set(entry.errorCodes)];
      for (const code of entry.errorCodes) errorCodes.add(code);
    }
    const status = includeFec && coverage.every(e=>e.fecStatus === 'complete') ? 'complete'
      : includeFec && coverage.some(e=>['complete','partial'].includes(e.fecStatus)) ? 'partial'
      : coverage.every(e=>e.status === 'complete' && ['complete','skipped'].includes(e.fecStatus)) ? 'complete'
      : coverage.some(e=>['partial','complete'].includes(e.status)) ? 'partial' : coverage.some(e=>e.status === 'failed') ? 'failed' : 'unsupported';
    await finishElectionRun(run.id,{status,counts,coverage,errorCodes:[...errorCodes]},pool);
    return {runId:run.id,status,counts,coverage,errorCodes:[...errorCodes]};
  } catch (error) {
    await finishElectionRun(run.id,{status:'failed',counts,coverage,errorCodes:[safeCode(error)]},pool);
    throw error;
  }
}
