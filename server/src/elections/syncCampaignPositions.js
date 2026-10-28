import defaultDb from '../db/client.js';
import { crawlCampaignSite } from './crawlCampaign.js';
import { createCampaignExtractionProvider, validateCampaignPositions } from './extractPositions.js';
import {
  saveCampaignSnapshot,
  publishCampaignPositions,
  recordCampaignFailure,
  startElectionRun,
  finishElectionRun
} from '../db/queries/elections.js';
import { RELEASE_SCOPE } from './contracts.js';
import { discoveryScope } from './discoveryUtils.js';

export async function syncCampaignPositions({
  scope = RELEASE_SCOPE,
  candidacyId = null,
  provider = null,
  maxPages = 5,
  checkDns = true,
  customFetcher = null,
  db = defaultDb
} = {}) {
  const normScope = discoveryScope(scope);
  provider ??= createCampaignExtractionProvider();

  const run = await startElectionRun({
    stage: 'crawl',
    scope: normScope,
    adapter: 'crawlee-v1',
    adapterVersion: '1.0'
  }, db);

  const query = `
    SELECT c.id AS candidacy_id, c.candidate_id, ca.name AS candidate_name, c.party AS candidate_party,
           r.office, r.state, r.district, r.senate_seat, r.election_date,
           s.id AS site_id, s.proposed_url, s.status AS site_status, s.approved_destinations, s.review_after, s.evidence
    FROM election_candidacies c
    JOIN election_candidates ca ON ca.id = c.candidate_id
    JOIN election_races r ON r.id = c.race_id
    JOIN campaign_sites s ON s.candidacy_id = c.id AND s.is_current
    WHERE s.status IN ('verified','ambiguous') AND s.review_after > now()
      AND jsonb_array_length(s.approved_destinations) > 0
      AND c.eligibility NOT IN ('withdrawn', 'disqualified')
      AND ($1::text[] IS NULL OR r.state = ANY($1::text[]))
      AND ($2::text[] IS NULL OR r.office = ANY($2::text[]))
      AND ($3::uuid IS NULL OR c.id = $3::uuid)
    ORDER BY r.state, r.office, c.id
  `;

  const { rows } = await db.query(query, [normScope.states, normScope.offices, candidacyId]);

  const counts = {
    candidaciesFound: rows.length,
    crawledSuccess: 0,
    crawlFailed: 0,
    snapshotsSaved: 0,
    positionsExtracted: 0,
    positionsPublished: 0,
    extractionFailed: 0
  };

  const coverageMap = new Map();
  for (const state of normScope.states) {
    for (const office of normScope.offices) {
      coverageMap.set(`${state}:${office}`, { state, office, status: 'complete', candidates: 0 });
    }
  }

  for (const row of rows) {
    const key = `${row.state}:${row.office}`;
    const cov = coverageMap.get(key);
    if (cov) cov.candidates++;

    const siteRecord = {
      id: row.site_id,
      candidacy_id: row.candidacy_id,
      proposed_url: row.proposed_url,
      status: row.site_status,
      approved_destinations: row.approved_destinations,
      review_after: row.review_after,
      evidence: row.evidence
    };

    let crawlResult;
    try {
      crawlResult = await crawlCampaignSite({
        site: siteRecord,
        startUrl: row.proposed_url,
        maxPages,
        checkDns,
        customFetcher
      });
    } catch (err) {
      await recordCampaignFailure({
        candidacyId: row.candidacy_id,
        runId: run.id,
        status: 'crawl-failed'
      }, db);
      counts.crawlFailed++;
      if (cov) cov.status = 'partial';
      continue;
    }

    counts.crawledSuccess++;

    for (const page of crawlResult.pages) {
      let snapshot;
      try {
        snapshot = await saveCampaignSnapshot({
          candidacyId: row.candidacy_id,
          siteId: row.site_id,
          requestedUrl: page.requestedUrl,
          finalUrl: page.finalUrl,
          retrievedAt: page.retrievedAt,
          text: page.text
        }, db);
      } catch (err) {
        console.warn('snapshot_save_error', { candidacyId: row.candidacy_id, url: page.finalUrl, message: err.message });
        continue;
      }

      counts.snapshotsSaved++;

      const normSnapshot = {
        id: snapshot.id,
        candidacyId: snapshot.candidacy_id,
        text: snapshot.source_text,
        requestedUrl: snapshot.requested_url,
        finalUrl: snapshot.final_url,
        final_url: snapshot.final_url,
        retrievedAt: snapshot.retrieved_at
      };

      const candidateContext = {
        name: row.candidate_name,
        party: row.candidate_party,
        office: row.office,
        state: row.state,
        district: row.district,
        senateSeat: row.senate_seat,
        electionDate: row.election_date
      };

      let rawPositions = [];
      try {
        rawPositions = await provider.extractPositions(normSnapshot, candidateContext);
      } catch (err) {
        await recordCampaignFailure({
          candidacyId: row.candidacy_id,
          snapshotId: snapshot.id,
          runId: run.id,
          status: 'extraction-failed'
        }, db);
        counts.extractionFailed++;
        if (cov) cov.status = 'partial';
        continue;
      }

      counts.positionsExtracted += rawPositions.length;

      const validated = validateCampaignPositions(rawPositions, normSnapshot);

      try {
        const published = await publishCampaignPositions({
          candidacyId: row.candidacy_id,
          snapshotId: snapshot.id,
          completeness: 'complete',
          model: provider.model,
          promptVersion: provider.promptVersion,
          items: validated.items
        }, db);
        counts.positionsPublished += published.length;
      } catch (err) {
        console.warn('publication_failed', { candidacyId: row.candidacy_id, snapshotId: snapshot.id, message: err.message });
        if (cov) cov.status = 'partial';
      }
    }
  }

  const coverage = Array.from(coverageMap.values());
  const hasFailures = counts.crawlFailed > 0 || counts.extractionFailed > 0;
  const overallStatus = hasFailures ? 'partial' : 'complete';

  const finished = await finishElectionRun(run.id, {
    status: overallStatus,
    counts,
    coverage,
    errorCodes: hasFailures ? ['has-partial-failures'] : []
  }, db);

  return {
    runId: finished.id,
    status: overallStatus,
    counts,
    coverage
  };
}
