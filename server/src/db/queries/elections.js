import { createHash } from 'node:crypto';
import db from '../client.js';
import { RELEASE_SCOPE, normalizeRace, normalizeState, normalizeDistrict, validateExtractionItem, positionVersionKey, ELECTION_GEOGRAPHY_SOURCE, ELECTION_GEOGRAPHY_VERSION } from '../../elections/contracts.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const one = async (runner, sql, values = []) => (await runner.query(sql, values)).rows[0];
const required = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`Missing ${field}`);
  return value;
};
// Pass a Pool, never a shared checked-out client: every operation owns its transaction.
async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
function scopeOf(input = RELEASE_SCOPE) {
  const scope = { ...RELEASE_SCOPE, ...input };
  if (scope.cycle !== 2026 || scope.stage !== 'general' || scope.contestType !== 'regular'
    || scope.geography !== RELEASE_SCOPE.geography
    || !Array.isArray(scope.states) || !scope.states.length || scope.states.some(s => !RELEASE_SCOPE.states.includes(s))
    || !Array.isArray(scope.offices) || !scope.offices.length || scope.offices.some(o => !RELEASE_SCOPE.offices.includes(o))) {
    throw new TypeError('Scope must narrow RELEASE_SCOPE');
  }
  const states=[...new Set(scope.states)].sort(), offices=[...new Set(scope.offices)].sort();
  if (scope.district !== undefined && (offices.length!==1 || offices[0]!=='house' || states.length!==1)) {
    throw new TypeError('District-scoped election work must target one state House race');
  }
  return { ...scope, ...(scope.district!==undefined ? {district:normalizeDistrict(scope.district)} : {}), states, offices };
}

// Identity must be an official person identifier, never a committee ID or a name.
// Linking another source requires explicit cross-reference evidence and candidateId.
export async function importElectionCandidate(input, pool = db) {
  return transaction(pool, c => importCandidate(input,c));
}
async function importCandidate(input, c) {
  const { identity, name, race, raceEvidence, party = null, eligibility = 'unknown', eligibilityEvidence = {}, candidateId = null } = input;
  required(identity.system, 'identity system'); required(identity.id, 'identity id'); required(name, 'name');
  if (identity.system.includes('committee')) throw new TypeError('Committee IDs cannot establish person identity');
  const r = normalizeRace(race);
    // Serialize source identity creation and explicit cross-source linking.
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([identity.system, identity.id])]);
    const existing = await one(c, 'SELECT candidate_id FROM election_candidate_identities WHERE system=$1 AND source_id=$2', [identity.system, identity.id]);
    if (existing && candidateId && existing.candidate_id !== candidateId) throw new Error('Identity already belongs to another candidate');
    let id = existing?.candidate_id ?? candidateId;
    if (candidateId && !existing && !identity.evidence?.crossReference) throw new Error('Official cross-reference required to link identities');
    if (!id) id = (await one(c, `INSERT INTO election_candidates(name,match_status,match_evidence,member_id)
      VALUES($1,$2,$3,$4) RETURNING id`, [name, input.matchStatus ?? 'unresolved', input.matchEvidence ?? {}, input.memberId ?? null])).id;
    else await c.query('UPDATE election_candidates SET name=$2,updated_at=now() WHERE id=$1', [id, name]);
    await c.query(`INSERT INTO election_candidate_identities(system,source_id,candidate_id,evidence) VALUES($1,$2,$3,$4)
      ON CONFLICT(system,source_id) DO UPDATE SET evidence=EXCLUDED.evidence`, [identity.system, identity.id, id, identity.evidence ?? {}]);
    return upsertElectionCandidacy({race:r,raceEvidence,party,eligibility,eligibilityEvidence}, id, c);
}

// Shared with evidence-backed discovery promotion. Caller owns the transaction.
export async function upsertElectionCandidacy({race,raceEvidence,party=null,eligibility='unknown',eligibilityEvidence={}}, id, c) {
    const r = normalizeRace(race);
    const savedRace = await one(c, `INSERT INTO election_races(office,state,district,senate_seat,election_date,stage,contest_type,evidence)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(office,state,district,senate_seat,election_date,stage,contest_type)
      DO UPDATE SET evidence=EXCLUDED.evidence RETURNING *`, [r.office,r.state,r.district,r.senateSeat,r.electionDate,r.stage,r.contestType,raceEvidence]);
    const candidacy = await one(c, `INSERT INTO election_candidacies(candidate_id,race_id,party,eligibility,eligibility_evidence)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(candidate_id,race_id) DO UPDATE SET
      party=COALESCE(EXCLUDED.party,election_candidacies.party),
      eligibility=CASE WHEN EXCLUDED.eligibility_evidence->>'system' LIKE 'state:%' AND EXCLUDED.eligibility<>'unknown'
        AND (COALESCE(election_candidacies.eligibility_evidence->>'effectiveAt',election_candidacies.eligibility_evidence->>'checkedAt') IS NULL OR
          COALESCE(EXCLUDED.eligibility_evidence->>'effectiveAt',EXCLUDED.eligibility_evidence->>'checkedAt')::timestamptz >=
          COALESCE(election_candidacies.eligibility_evidence->>'effectiveAt',election_candidacies.eligibility_evidence->>'checkedAt')::timestamptz)
        AND (election_candidacies.eligibility=EXCLUDED.eligibility OR
          COALESCE(election_candidacies.eligibility_evidence->>'effectiveAt',election_candidacies.eligibility_evidence->>'checkedAt') IS NULL OR
          COALESCE(EXCLUDED.eligibility_evidence->>'effectiveAt',EXCLUDED.eligibility_evidence->>'checkedAt')::timestamptz >
          COALESCE(election_candidacies.eligibility_evidence->>'effectiveAt',election_candidacies.eligibility_evidence->>'checkedAt')::timestamptz)
        AND (election_candidacies.eligibility NOT IN ('withdrawn','disqualified') OR EXCLUDED.eligibility<>'ballot-confirmed'
          OR EXCLUDED.eligibility_evidence->>'reinstated'='true')
        THEN EXCLUDED.eligibility ELSE election_candidacies.eligibility END,
      eligibility_evidence=CASE WHEN EXCLUDED.eligibility_evidence->>'system' LIKE 'state:%' AND EXCLUDED.eligibility<>'unknown'
        AND (COALESCE(election_candidacies.eligibility_evidence->>'effectiveAt',election_candidacies.eligibility_evidence->>'checkedAt') IS NULL OR
          COALESCE(EXCLUDED.eligibility_evidence->>'effectiveAt',EXCLUDED.eligibility_evidence->>'checkedAt')::timestamptz >=
          COALESCE(election_candidacies.eligibility_evidence->>'effectiveAt',election_candidacies.eligibility_evidence->>'checkedAt')::timestamptz)
        AND (election_candidacies.eligibility=EXCLUDED.eligibility OR
          COALESCE(election_candidacies.eligibility_evidence->>'effectiveAt',election_candidacies.eligibility_evidence->>'checkedAt') IS NULL OR
          COALESCE(EXCLUDED.eligibility_evidence->>'effectiveAt',EXCLUDED.eligibility_evidence->>'checkedAt')::timestamptz >
          COALESCE(election_candidacies.eligibility_evidence->>'effectiveAt',election_candidacies.eligibility_evidence->>'checkedAt')::timestamptz)
        AND (election_candidacies.eligibility NOT IN ('withdrawn','disqualified') OR EXCLUDED.eligibility<>'ballot-confirmed'
          OR EXCLUDED.eligibility_evidence->>'reinstated'='true')
        THEN EXCLUDED.eligibility_evidence ELSE election_candidacies.eligibility_evidence END,
      updated_at=now() RETURNING *`, [id,savedRace.id,party,eligibility,eligibilityEvidence]);
    return { candidateId: id, race: savedRace, candidacy };
}

// One race's authoritative observations commit together. Absence never implies
// withdrawal; adapters must supply explicit dated state withdrawal evidence.
export async function reconcileElectionRace({race, records}, pool = db) {
  const expected=JSON.stringify(normalizeRace(race));
  if (!Array.isArray(records) || records.some(record=>JSON.stringify(normalizeRace(record.race))!==expected)) throw new TypeError('Reconciliation must target one exact race');
  return transaction(pool, async c => {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[expected]);
    const result=[];
    for (const record of records) result.push(await importCandidate(record,c));
    return result;
  });
}

export async function saveCampaignSite(input, pool = db) {
  return transaction(pool, async c => {
    await c.query('SELECT id FROM election_candidacies WHERE id=$1 FOR UPDATE', [input.candidacyId]);
    if (input.reuseIfCurrent) {
      const current = await one(c, 'SELECT * FROM campaign_sites WHERE candidacy_id=$1 AND is_current',[input.candidacyId]);
      if (current && current.proposed_url === (input.url ?? null) && current.status === input.status
        && current.evidence.recordKey === input.evidence?.recordKey
        && (!['verified','ambiguous'].includes(current.status) || new Date(current.review_after)>new Date())) return current;
    }
    const prior = await one(c, 'SELECT COALESCE(max(revision),0)+1 AS revision FROM campaign_sites WHERE candidacy_id=$1', [input.candidacyId]);
    await c.query('UPDATE campaign_sites SET is_current=false WHERE candidacy_id=$1 AND is_current', [input.candidacyId]);
    return one(c, `INSERT INTO campaign_sites(candidacy_id,revision,proposed_url,status,approved_destinations,evidence,checked_at,review_after,invalidation_reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [input.candidacyId,prior.revision,input.url ?? null,input.status,
      JSON.stringify(input.approvedDestinations ?? []),input.evidence ?? {},input.checkedAt,input.reviewAfter ?? null,input.invalidationReason ?? null]);
  });
}

function approved(url, destinations) {
  const target = new URL(url);
  return ['https:', 'http:'].includes(target.protocol) && !target.username && !target.password && destinations.some(d =>
    target.origin === d.origin && (target.pathname === d.pathPrefix || target.pathname.startsWith(d.pathPrefix.endsWith('/') ? d.pathPrefix : `${d.pathPrefix}/`)));
}
export async function saveCampaignSnapshot(input, pool = db) {
  return transaction(pool, async c => {
    const site = await one(c, `SELECT * FROM campaign_sites WHERE id=$1 AND candidacy_id=$2 AND is_current
      AND status IN ('verified','ambiguous') AND review_after>now() FOR SHARE`, [input.siteId,input.candidacyId]);
    if (!site || !approved(input.requestedUrl,site.approved_destinations) || !approved(input.finalUrl,site.approved_destinations)) throw new Error('Eligible approved campaign destination required');
    if (typeof input.text !== 'string') throw new TypeError('Snapshot text required');
    const values = [input.candidacyId,site.id,input.requestedUrl,input.finalUrl,input.retrievedAt,input.text,hash(input.text),site.evidence];
    // A retry must not rewrite the original retrieval date or captured evidence.
    await c.query(`INSERT INTO campaign_sources(candidacy_id,site_id,requested_url,final_url,retrieved_at,source_text,fingerprint,verification_evidence)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(candidacy_id,final_url,fingerprint,site_id) DO NOTHING`, values);
    const source=await one(c, 'SELECT * FROM campaign_sources WHERE candidacy_id=$1 AND final_url=$2 AND fingerprint=$3 AND site_id=$4', [input.candidacyId,input.finalUrl,hash(input.text),site.id]);
    await c.query('INSERT INTO campaign_fetch_attempts(snapshot_id,fetched_at,requested_url) VALUES($1,$2,$3)',[source.id,input.retrievedAt,input.requestedUrl]);
    return source;
  });
}

export async function startElectionRun(input, runner = db) {
  return one(runner, `INSERT INTO election_ingestion_runs(stage,scope,adapter,adapter_version,last_successful_run_id)
    VALUES($1,$2,$3,$4,$5) RETURNING *`, [input.stage,scopeOf(input.scope),input.adapter,input.adapterVersion,input.lastSuccessfulRunId ?? null]);
}
export async function finishElectionRun(id, input, runner = db) {
  // Persist only bounded machine codes, never raw provider errors, tokens or URLs containing secrets.
  if (!['complete','partial','failed','unsupported'].includes(input.status) || (input.errorCodes ?? []).some(e => !/^[a-z0-9-]{1,80}$/.test(e))) throw new TypeError('Invalid run outcome');
  if (input.status==='complete') {
    const run=await one(runner,'SELECT scope FROM election_ingestion_runs WHERE id=$1',[id]);
    if (!run || run.scope.states.some(state=>run.scope.offices.some(office=>
      !(input.coverage ?? []).some(entry=>entry.state===state && entry.office===office
        && (run.scope.district == null || entry.district===run.scope.district) && entry.status==='complete')))) throw new Error('Complete coverage evidence required for every requested state/office');
  }
  return one(runner, `UPDATE election_ingestion_runs SET status=$2,counts=$3,coverage=$4,error_codes=$5,finished_at=now()
    WHERE id=$1 AND status='pending' RETURNING *`, [id,input.status,input.counts ?? {},JSON.stringify(input.coverage ?? []),JSON.stringify(input.errorCodes ?? [])]);
}

const BUILD_STAGES = Object.freeze(['candidates','websites','positions']);
const BUILD_RETRY_MS = 15 * 60 * 1000;
function electionBuildProgress(input = {}) {
  const stages = input.stages ?? {};
  const normalized = Object.fromEntries(BUILD_STAGES.map(stage => {
    const status = stages[stage] ?? 'pending';
    if (!['pending','running','complete','partial','failed'].includes(status)) throw new TypeError('Invalid election build stage status');
    return [stage,status];
  }));
  return { stages: normalized };
}
function electionBuildJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    cycle: row.cycle,
    state: row.state,
    office: row.office,
    district: row.district,
    status: row.status,
    attempts: row.attempts,
    progress: electionBuildProgress(row.progress),
    errorCodes: row.error_codes ?? [],
    requestedAt: row.requested_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    leaseExpiresAt: row.lease_expires_at ?? null,
    retryAfter: row.retry_after,
    updatedAt: row.updated_at,
  };
}

export async function ensureElectionFeedBuildJobs({state:inputState,district:inputDistrict=null,offices=['house','senate']},runner=db) {
  const state=normalizeState(inputState);
  const district=inputDistrict == null ? null : normalizeDistrict(inputDistrict);
  if (!Array.isArray(offices) || !offices.length || offices.some(office=>!['house','senate'].includes(office))) {
    throw new TypeError('Invalid election build offices');
  }
  return transaction(runner,async c=>{
    const jobs=[];
    for (const office of [...new Set(offices)]) {
      if (office==='house' && district===null) continue;
      const jobDistrict=office==='house'?district:null;
      await c.query(`INSERT INTO election_feed_build_jobs(cycle,stage,contest_type,state,office,district)
        VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT (cycle,state,office,(COALESCE(district,-1))) DO NOTHING`,
      [RELEASE_SCOPE.cycle,RELEASE_SCOPE.stage,RELEASE_SCOPE.contestType,state,office,jobDistrict]);
      await c.query(`UPDATE election_feed_build_jobs SET status='queued',lease_expires_at=NULL,finished_at=NULL,
          retry_after=NULL,error_codes='[]'::jsonb,requested_at=now(),updated_at=now()
        WHERE cycle=$1 AND stage=$2 AND contest_type=$3 AND state=$4 AND office=$5
          AND district IS NOT DISTINCT FROM $6::integer AND status IN ('partial','failed') AND retry_after<=now()`,
      [RELEASE_SCOPE.cycle,RELEASE_SCOPE.stage,RELEASE_SCOPE.contestType,state,office,jobDistrict]);
      const row=await one(c,`SELECT * FROM election_feed_build_jobs
        WHERE cycle=$1 AND stage=$2 AND contest_type=$3 AND state=$4 AND office=$5
          AND district IS NOT DISTINCT FROM $6::integer`,
      [RELEASE_SCOPE.cycle,RELEASE_SCOPE.stage,RELEASE_SCOPE.contestType,state,office,jobDistrict]);
      jobs.push(electionBuildJob(row));
    }
    return jobs;
  });
}

export async function readElectionFeedBuildJobs({state:inputState,district:inputDistrict=null,offices=['house','senate']},runner=db) {
  const state=normalizeState(inputState);
  const district=inputDistrict == null ? null : normalizeDistrict(inputDistrict);
  const normalizedOffices=[...new Set(offices)];
  if (normalizedOffices.some(office=>!['house','senate'].includes(office))) throw new TypeError('Invalid election build offices');
  const {rows}=await runner.query(`SELECT * FROM election_feed_build_jobs
    WHERE cycle=$1 AND stage=$2 AND contest_type=$3 AND state=$4
      AND ((office='house' AND district=$5) OR (office='senate' AND district IS NULL AND 'senate'=ANY($6::text[])))
      AND office=ANY($6::text[])
    ORDER BY office`,[RELEASE_SCOPE.cycle,RELEASE_SCOPE.stage,RELEASE_SCOPE.contestType,state,district,normalizedOffices]);
  return rows.map(electionBuildJob);
}

export async function claimElectionFeedBuildJob({jobId=null,leaseMs=120000}={},runner=db) {
  if (jobId!==null && (typeof jobId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId))) {
    throw new TypeError('Invalid election build job ID');
  }
  if (!Number.isInteger(leaseMs) || leaseMs<30000 || leaseMs>600000) throw new TypeError('Invalid election build lease');
  return transaction(runner,async c=>{
    const row=await one(c,`WITH candidate AS (
        SELECT id FROM election_feed_build_jobs
        WHERE (status='queued' OR (status='running' AND lease_expires_at<=now()))
          AND ($2::uuid IS NULL OR id=$2::uuid)
        ORDER BY requested_at,created_at
        LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      UPDATE election_feed_build_jobs j SET status='running',attempts=j.attempts+1,
        started_at=COALESCE(j.started_at,now()),finished_at=NULL,retry_after=NULL,
        lease_expires_at=now()+($1::integer*interval '1 millisecond'),updated_at=now()
      FROM candidate WHERE j.id=candidate.id RETURNING j.*`,[leaseMs,jobId]);
    return electionBuildJob(row);
  });
}

export async function renewElectionFeedBuildLease(id,{leaseMs=120000}={},runner=db) {
  const row=await one(runner,`UPDATE election_feed_build_jobs SET lease_expires_at=now()+($2::integer*interval '1 millisecond'),updated_at=now()
    WHERE id=$1 AND status='running' RETURNING id`,[id,leaseMs]);
  return Boolean(row);
}

export async function updateElectionFeedBuildProgress(id,progress,runner=db) {
  const normalized=electionBuildProgress(progress);
  const row=await one(runner,`UPDATE election_feed_build_jobs SET progress=$2,updated_at=now()
    WHERE id=$1 AND status='running' RETURNING id`,[id,JSON.stringify(normalized)]);
  return Boolean(row);
}

export async function finishElectionFeedBuildJob(id,{status,progress,errorCodes=[]},runner=db) {
  if (!['complete','partial','failed'].includes(status) || !Array.isArray(errorCodes)
    || errorCodes.some(code=>typeof code!=='string'||!/^[a-z0-9-]{1,80}$/.test(code))) throw new TypeError('Invalid election build outcome');
  const normalized=electionBuildProgress(progress);
  return one(runner,`UPDATE election_feed_build_jobs SET status=$2,progress=$3,error_codes=$4,
    lease_expires_at=NULL,finished_at=now(),retry_after=CASE WHEN $2 IN ('partial','failed') THEN now()+($5::integer*interval '1 millisecond') ELSE NULL END,
    updated_at=now() WHERE id=$1 AND status='running' RETURNING *`,[id,status,JSON.stringify(normalized),JSON.stringify([...new Set(errorCodes)]),BUILD_RETRY_MS]).then(electionBuildJob);
}

export async function recordCampaignFailure(input, pool = db) {
  if (!['crawl-failed','extraction-failed'].includes(input.status)) throw new TypeError('Invalid failure status');
  return transaction(pool, async c => {
    await c.query(`UPDATE election_candidacies SET availability=$2,failure_code=$2,last_attempt_at=now(),updated_at=now() WHERE id=$1`, [input.candidacyId,input.status]);
    return one(c, `INSERT INTO campaign_processing_attempts(candidacy_id,snapshot_id,run_id,status,model,prompt_version,validation)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [input.candidacyId,input.snapshotId ?? null,input.runId ?? null,input.status,input.model ?? null,input.promptVersion ?? null,input.validation ?? {}]);
  });
}

// Network fetching, AI and semantic validation must finish BEFORE this call.
// Complete reconciliation removes only claims from this exact source URL.
export async function publishCampaignPositions(input, pool = db) {
  required(input.model,'model'); required(input.promptVersion,'promptVersion');
  if (!Array.isArray(input.items) || !['complete','partial'].includes(input.completeness)) throw new TypeError('Explicit reconciliation completeness required');
  return transaction(pool, async c => {
    await c.query('SELECT id FROM election_candidacies WHERE id=$1 FOR UPDATE', [input.candidacyId]);
    const source = await one(c, `SELECT s.* FROM campaign_sources s JOIN campaign_sites w ON w.id=s.site_id
      WHERE s.id=$1 AND s.candidacy_id=$2 AND w.is_current AND w.status IN ('verified','ambiguous') AND w.review_after>now() FOR SHARE OF w`, [input.snapshotId,input.candidacyId]);
    if (!source) throw new Error('Current verified or ambiguous snapshot required');
    const seen = new Set();
    const seenText = new Set();
    for (const item of input.items) {
      if (validateExtractionItem(item,{id:source.id,candidacyId:source.candidacy_id,text:source.source_text}).errors.length
        || item.validation?.outcome !== 'valid' || !item.validation.validatorVersion || !Array.isArray(item.validation.reasons)
        || seen.has(item.claimId) || seenText.has(item.claimText)) throw new Error('Invalid, unvalidated or duplicate claim');
      required(item.claimId,'claimId'); seen.add(item.claimId); seenText.add(item.claimText);
    }
    const attempt = await one(c, `INSERT INTO campaign_processing_attempts(candidacy_id,snapshot_id,run_id,status,model,prompt_version,validation,reconciliation)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [input.candidacyId,source.id,input.runId ?? null,input.completeness,input.model,input.promptVersion,
      {items:input.items.map(i => i.validation)}, {completeness:input.completeness,sourceUrl:source.final_url,claimIds:[...seen]}]);
    const result = [];
    for (const item of input.items) {
      await c.query('INSERT INTO campaign_claims(id,candidacy_id) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [item.claimId,input.candidacyId]);
      const key = positionVersionKey({candidacyId:input.candidacyId,claimId:item.claimId,claimText:item.claimText});
      // Supersede before insert, inside the same transaction and candidacy lock.
      await c.query(`UPDATE campaign_position_versions SET state='superseded' WHERE claim_id=$1 AND state='published' AND version_key<>$2`, [item.claimId,key]);
      await c.query(`INSERT INTO campaign_position_versions(candidacy_id,claim_id,snapshot_id,version_key,claim_text,topic,summary,excerpt,state,model,prompt_version,validation)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'published',$9,$10,$11) ON CONFLICT(version_key) DO NOTHING`,
      [input.candidacyId,item.claimId,source.id,key,item.claimText,item.topic,item.summary,item.excerpt,input.model,input.promptVersion,item.validation]);
      const version = await one(c, `UPDATE campaign_position_versions SET state='published' WHERE version_key=$1 RETURNING *`, [key]);
      await c.query(`INSERT INTO campaign_position_evidence(position_version_id,snapshot_id,attempt_id,presentation) VALUES($1,$2,$3,$4)`,
        [version.id,source.id,attempt.id,{summary:item.summary,excerpt:item.excerpt,topic:item.topic,validation:item.validation}]);
      result.push(version);
    }
    if (input.completeness === 'complete') await c.query(`UPDATE campaign_position_versions p SET state='removed'
      FROM campaign_sources s WHERE p.snapshot_id=s.id AND p.candidacy_id=$1 AND s.final_url=$2
      AND p.state='published' AND NOT(p.claim_id=ANY($3::uuid[]))`, [input.candidacyId,source.final_url,[...seen]]);
    await c.query(`UPDATE election_candidacies SET availability=CASE WHEN EXISTS(
      SELECT 1 FROM campaign_position_versions WHERE candidacy_id=$1 AND state='published') THEN 'available' ELSE $2 END,
      last_attempt_at=now(),last_success_at=CASE WHEN $3 THEN now() ELSE last_success_at END,failure_code=NULL,updated_at=now() WHERE id=$1`,
    [input.candidacyId,input.completeness === 'complete' ? 'no-positions' : 'pending',input.completeness === 'complete']);
    return result;
  });
}

export async function saveElectionGeography(input, runner = db) {
  const state = normalizeState(input.state);
  const status = input.status;
  if (!['verified','unresolved'].includes(status)) throw new TypeError('Invalid election geography status');
  const district = status === 'verified' ? normalizeDistrict(input.district) : null;
  if (!Number.isInteger(input.cycle) || typeof input.boundaryVersion !== 'string' ||
      typeof input.sourceUrl !== 'string' || !input.sourceUrl.startsWith('https://') ||
      !Number.isFinite(Date.parse(input.checkedAt))) throw new TypeError('Invalid election geography evidence');
  return one(runner, `INSERT INTO election_geography_evidence(state,district,cycle,boundary_version,source_url,checked_at,status)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
  [state,district,input.cycle,input.boundaryVersion,input.sourceUrl,input.checkedAt,status]);
}

// Only trusted server code supplies auth.clerkUserId (req.auth().userId).
// Never accept a user ID from a request body/query or trust req.user without Clerk.
async function owner(auth, runner, optional = false) {
  if (!auth?.clerkUserId) { if (optional) return null; throw new Error('Authentication required'); }
  const user = await one(runner,'SELECT id FROM users WHERE clerk_user_id=$1',[auth.clerkUserId]);
  if (!user || auth.userId != null && auth.userId !== user.id) throw new Error('Authenticated user mapping mismatch');
  return user.id;
}
export async function readElectionGeographyForUser(auth, runner = db) {
  const userId = await owner(auth,runner);
  return await one(runner, `SELECT e.id AS "evidenceId",e.state,e.district,e.cycle,
      e.boundary_version AS "boundaryVersion",e.source_url AS "sourceUrl",e.checked_at AS "checkedAt",e.status
    FROM users u LEFT JOIN election_geography_evidence e ON e.id=u.election_geography_evidence_id
    WHERE u.id=$1`, [userId]) ?? null;
}
export async function saveElectionResponse(auth, input, runner = db) {
  const userId = await owner(auth,runner);
  if ('userId' in input || 'user_id' in input) throw new Error('Client ownership override forbidden');
  return one(runner, `INSERT INTO election_interactions(user_id,position_version_id,stance,private_comment)
    SELECT $1,p.id,$3,$4 FROM campaign_position_versions p
    WHERE p.id=$2 AND p.state='published' AND p.validation->>'outcome'='valid'
    ON CONFLICT(user_id,position_version_id) DO UPDATE SET stance=EXCLUDED.stance,
    private_comment=CASE WHEN $5 THEN EXCLUDED.private_comment ELSE election_interactions.private_comment END,updated_at=now() RETURNING *`,
  [userId,input.positionVersionId,input.stance,input.privateComment ?? null,Object.hasOwn(input,'privateComment')]);
}
export async function getElectionResponse(auth, positionVersionId, runner = db) {
  const userId = await owner(auth,runner);
  return await one(runner,'SELECT * FROM election_interactions WHERE user_id=$1 AND position_version_id=$2',[userId,positionVersionId]) ?? null;
}
export async function deleteElectionResponse(auth, positionVersionId, runner = db) {
  const userId = await owner(auth,runner);
  return await one(runner,'DELETE FROM election_interactions WHERE user_id=$1 AND position_version_id=$2 RETURNING id',[userId,positionVersionId]) ?? null;
}
// Clearing a public stance must retain any private service data on the row.
export async function clearElectionResponse(auth, positionVersionId, runner = db) {
  const userId = await owner(auth,runner);
  return await one(runner, `UPDATE election_interactions SET stance=NULL,updated_at=now()
    WHERE user_id=$1 AND position_version_id=$2 AND EXISTS(SELECT 1 FROM campaign_position_versions p
      WHERE p.id=position_version_id AND p.state='published' AND p.validation->>'outcome'='valid')
    RETURNING id,position_version_id AS "positionVersionId"`,
  [userId,positionVersionId]) ?? null;
}

function trustedGeography(input, state, scope) {
  return input?.status === 'verified' && input.state === state && input.cycle === scope.cycle &&
    input.boundaryVersion === ELECTION_GEOGRAPHY_VERSION && input.sourceUrl === ELECTION_GEOGRAPHY_SOURCE &&
    Number.isInteger(input.district) && input.district >= 0 && input.district <= 99;
}

function coverageSummary(runs, state, offices, geographyVerified, district=null) {
  const byOffice = Object.fromEntries(['house','senate'].map(office => {
    if (office === 'house' && !geographyVerified) return [office,'geography-unverified'];
    if (!offices.includes(office)) return [office,'not-requested'];
    const entries = Array.isArray(runs?.[office]?.coverage) ? runs[office].coverage : [];
    const entry = entries.find(value => value.state === state && value.office === office
      && (office==='senate' || value.district == null || value.district===district));
    if (entry?.status === 'complete' && entry.noRaces === true) return [office,'no-race'];
    return [office,entry?.status ?? 'unknown'];
  }));
  const selected = offices.map(office => byOffice[office]);
  const status = selected.length && selected.every(value => ['complete','no-race'].includes(value)) ? 'complete'
    : selected.some(value => ['complete','no-race','partial'].includes(value)) ? 'partial' : 'unknown';
  return {
    status,
    byOffice,
    message: status === 'complete' ? null : status === 'partial'
      ? 'Candidate coverage is incomplete for one or more matching races.'
      : 'Candidate coverage has not been confirmed for these matching races.',
    runStatus: runs?.house?.status ?? runs?.senate?.status ?? null,
  };
}

export async function readElectionRoster(input, pool = db) {
  const state = normalizeState(input.state);
  const scope = scopeOf(input.scope);
  const chamber = input.chamber ?? 'all';
  if (!['all','house','senate'].includes(chamber)) throw new TypeError('Invalid election chamber');
  const offices = chamber === 'all' ? scope.offices : [chamber];
  const geographyVerified = trustedGeography(input.geography,state,scope);
  const district = geographyVerified ? normalizeDistrict(input.geography.district) : null;
  return transaction(pool, async c => {
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const candidates = (await c.query(`SELECT co.id AS "candidacyId",ca.id AS "candidateId",ca.name,
        jsonb_build_object('office',r.office,'state',r.state,'district',r.district,'senateSeat',r.senate_seat,
          'electionDate',r.election_date,'stage',r.stage,'contestType',r.contest_type) AS race,
        co.party,
        CASE WHEN ca.match_status='matched' AND ca.member_id IS NOT NULL AND rep.is_current_member THEN 'incumbent'
          WHEN ca.match_status='matched' AND ca.member_id IS NOT NULL AND NOT rep.is_current_member THEN 'not-incumbent' ELSE 'unknown' END AS incumbency,
        CASE WHEN ca.match_status='matched' THEN rep.image_url ELSE NULL END AS "portraitUrl",
        co.eligibility AS "ballotStatus",
        CASE WHEN EXISTS(SELECT 1 FROM election_candidate_identities fi WHERE fi.candidate_id=ca.id AND fi.system='fec:candidate')
          THEN 'fec-registered' ELSE 'state-listed' END AS "registrationStatus",
        CASE WHEN w.id IS NULL OR w.status='missing' THEN 'site-missing'
          WHEN w.status NOT IN ('verified','ambiguous') OR w.review_after IS NULL OR w.review_after<=now() THEN 'site-unverified'
          WHEN co.availability IN ('crawl-failed','extraction-failed') THEN co.availability
          WHEN EXISTS(SELECT 1 FROM campaign_position_versions p
            JOIN campaign_position_evidence pe ON pe.position_version_id=p.id
            JOIN campaign_sources s ON s.id=pe.snapshot_id
            WHERE p.candidacy_id=co.id AND p.state='published' AND p.validation->>'outcome'='valid'
              AND s.site_id=w.id AND s.candidacy_id=co.id) THEN 'available'
          ELSE co.availability END AS availability
      FROM election_races r JOIN election_candidacies co ON co.race_id=r.id
      JOIN election_candidates ca ON ca.id=co.candidate_id
      LEFT JOIN reps rep ON rep.bioguideid=ca.member_id AND ca.match_status='matched'
      LEFT JOIN campaign_sites w ON w.candidacy_id=co.id AND w.is_current
      WHERE r.state=$1 AND r.office=ANY($2::text[]) AND extract(year FROM r.election_date)=$3
        AND r.stage=$4 AND r.contest_type=$5 AND (r.office='senate' OR ($6::boolean AND r.district=$7))
        AND co.eligibility NOT IN ('withdrawn','disqualified')
      ORDER BY r.election_date,r.state,r.office,COALESCE(r.district,r.senate_seat),r.id,ca.id,co.id`,
    [state,offices,scope.cycle,scope.stage,scope.contestType,geographyVerified,district])).rows;
    const runs={};
    for (const office of offices) {
      if (office==='house' && !geographyVerified) continue;
      runs[office]=await one(c, `SELECT status,coverage,finished_at FROM election_ingestion_runs
        WHERE stage='discovery' AND adapter='public-evidence' AND status<>'pending'
          AND scope @> $1::jsonb AND (scope->>'district' IS NULL OR (scope->>'district')::integer=$2)
        ORDER BY COALESCE(scope->>'district'=$2::text,false) DESC,finished_at DESC,id DESC LIMIT 1`,
      [JSON.stringify({cycle:scope.cycle,stage:scope.stage,contestType:scope.contestType,states:[state],offices:[office]}),
        office==='house' ? district : null]);
    }
    const coverage = coverageSummary(runs,state,offices,geographyVerified,district);
    const availability = {
      overall: candidates.length ? 'available' : coverage.status === 'complete' &&
        offices.every(office => coverage.byOffice[office] === 'no-race') ? 'no-race' : 'coverage-unknown',
      house: !geographyVerified ? 'geography-unverified' : coverage.byOffice.house,
      senate: state ? coverage.byOffice.senate : 'geography-unavailable',
    };
    return {
      geography: {
        status: geographyVerified ? 'verified' : state ? 'state-only' : 'unavailable',
        state,
        houseDistrict: district,
      },
      candidates,
      coverage,
      availability,
    };
  });
}

export async function readElectionPositions(input, auth = null, pool = db) {
  const scope = scopeOf(input.scope), state = normalizeState(input.state);
  const district = input.district == null ? null : normalizeDistrict(input.district);
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit<1 || limit>50) throw new TypeError('Limit must be 1–50');
  return transaction(pool, async c => {
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const userId = await owner(auth,c,true);
    const storedGeography = input.geographyEvidenceId ? await one(c, `SELECT id,district FROM election_geography_evidence
      WHERE id=$1 AND state=$2 AND cycle=$3 AND status='verified' AND boundary_version=$4 AND source_url=$5`,
      [input.geographyEvidenceId,state,scope.cycle,ELECTION_GEOGRAPHY_VERSION,ELECTION_GEOGRAPHY_SOURCE]) : null;
    // `geography` is only supplied by trusted server callers after resolving the
    // submitted address. Browser-supplied state/district never reaches this API.
    const resolvedGeography = trustedGeography(input.geography,state,scope) && input.geography.district === district
      ? input.geography : null;
    const geography = storedGeography?.district === district ? storedGeography : resolvedGeography;
    const races = (await c.query(`SELECT r.*,co.id AS candidacy_id,co.availability,co.last_attempt_at,co.last_success_at,co.failure_code,
      co.eligibility,w.status AS site_status,w.review_after,w.id AS site_id
      FROM election_races r LEFT JOIN election_candidacies co ON co.race_id=r.id
      LEFT JOIN campaign_sites w ON w.candidacy_id=co.id AND w.is_current
      WHERE r.state=$1 AND r.state=ANY($2::text[]) AND r.office=ANY($3::text[]) AND extract(year FROM r.election_date)=$4
      AND r.stage=$5 AND r.contest_type=$6 AND (r.office='senate' OR ($7::boolean AND r.district=$8))
      ORDER BY r.election_date,r.state,r.office,COALESCE(r.district,r.senate_seat),r.id,co.candidate_id`,
    [state,scope.states,scope.offices,scope.cycle,scope.stage,scope.contestType,Boolean(geography),district])).rows;
    const allItems = (await c.query(`SELECT p.id AS "positionVersionId",p.claim_id AS "claimId",p.candidacy_id AS "candidacyId",p.topic,p.summary,p.excerpt,
      jsonb_build_object('id',ca.id,'candidateId',ca.id,'name',ca.name,'party',co.party,
        'incumbency',CASE WHEN ca.match_status='matched' AND ca.member_id IS NOT NULL AND rep.is_current_member THEN 'incumbent'
          WHEN ca.match_status='matched' AND ca.member_id IS NOT NULL AND NOT rep.is_current_member THEN 'not-incumbent' ELSE 'unknown' END,
        'portraitUrl',CASE WHEN ca.match_status='matched' THEN rep.image_url ELSE NULL END) AS candidate,
      jsonb_build_object('office',r.office,'state',r.state,'district',r.district,'senateSeat',r.senate_seat,
        'electionDate',r.election_date,'stage',r.stage,'contestType',r.contest_type) AS race,
      jsonb_build_object('snapshotId',s.id,'url',s.final_url,'retrievedAt',s.retrieved_at) AS source,
      co.eligibility AS "ballotStatus",
      CASE WHEN EXISTS(SELECT 1 FROM election_candidate_identities fi WHERE fi.candidate_id=ca.id AND fi.system='fec:candidate')
        THEN 'fec-registered' ELSE 'state-listed' END AS "registrationStatus",
      co.availability,CASE WHEN i.id IS NULL OR i.stance IS NULL THEN NULL ELSE jsonb_build_object('stance',i.stance) END AS response
      FROM campaign_position_versions p JOIN election_candidacies co ON co.id=p.candidacy_id
      JOIN election_candidates ca ON ca.id=co.candidate_id JOIN election_races r ON r.id=co.race_id
      JOIN campaign_sources s ON s.id=p.snapshot_id JOIN campaign_sites w ON w.candidacy_id=co.id AND w.is_current
      LEFT JOIN reps rep ON rep.bioguideid=ca.member_id
      LEFT JOIN election_interactions i ON i.position_version_id=p.id AND i.user_id=$1
      WHERE r.id=ANY($2::uuid[]) AND (co.eligibility='ballot-confirmed' OR (co.eligibility NOT IN ('withdrawn','disqualified')
        AND EXISTS(SELECT 1 FROM election_candidate_identities fi WHERE fi.candidate_id=co.candidate_id AND fi.system='fec:candidate'))) AND w.status IN ('verified','ambiguous') AND w.review_after>now()
      AND p.state='published' AND p.validation->>'outcome'='valid'
      AND EXISTS(SELECT 1 FROM campaign_position_evidence pe JOIN campaign_sources es ON es.id=pe.snapshot_id
        WHERE pe.position_version_id=p.id AND es.site_id=w.id AND es.candidacy_id=p.candidacy_id)
      ORDER BY r.election_date,r.state,r.office,COALESCE(r.district,r.senate_seat),r.id,ca.id,p.claim_id,p.id`,
    [userId,[...new Set(races.map(r=>r.id))]])).rows;
    const candidacyId = input.candidacyId ?? null;
    const policyArea = input.policyArea ?? null;
    const scopedItems = candidacyId == null ? allItems : allItems.filter(item => item.candidacyId === candidacyId);
    const policyCounts = {all:scopedItems.length,uncategorized:0,byPolicyArea:{}};
    for (const item of scopedItems) {
      if (item.topic == null) policyCounts.uncategorized += 1;
      else policyCounts.byPolicyArea[item.topic]=(policyCounts.byPolicyArea[item.topic] ?? 0)+1;
    }
    const visibleItems = policyArea == null ? scopedItems : scopedItems.filter(item => item.topic === policyArea);
    const coverage = (await c.query(`SELECT status,coverage,finished_at FROM election_ingestion_runs WHERE stage='discovery' AND status<>'pending'
      AND scope @> $1::jsonb ORDER BY finished_at DESC,id DESC LIMIT 1`,[JSON.stringify({cycle:scope.cycle,stage:scope.stage,contestType:scope.contestType,states:[state],offices:scope.offices})])).rows[0] ?? null;
    // Cursor binds the complete visible publication set and filter; mutation forces restart.
    const geographyBinding = geography?.id ?? (geography ? {state,district,boundaryVersion:geography.boundaryVersion} : null);
    const binding = hash(JSON.stringify({scope,state,district,geography:geographyBinding,candidacyId,policyArea,userId,races,items:visibleItems}));
    let offset = 0;
    if (input.cursor) {
      let cursor;
      try { cursor=JSON.parse(Buffer.from(input.cursor,'base64url').toString()); } catch { throw new TypeError('Invalid cursor'); }
      if (cursor.binding!==binding || !Number.isInteger(cursor.offset) || cursor.offset<0 || cursor.offset>visibleItems.length) {
        const error = new Error('Publication changed or cursor invalid; restart read');
        error.code = 'ELECTION_FEED_RESTART_REQUIRED'; error.status = 409; throw error;
      }
      offset=cursor.offset;
    }
    const knownEmpty = coverage?.status==='complete' && scope.offices.every(office=>
      (office!=='house' || geography) && coverage.coverage.some(entry => entry.state===state && entry.office===office && entry.status==='complete' && entry.noRaces===true));
    const raceResults = races.map(r => ({...r,availability: !r.candidacy_id ? 'pending' : !r.site_id || r.site_status==='missing' ? 'site-missing'
      : !['verified','ambiguous'].includes(r.site_status) || !r.review_after || new Date(r.review_after)<=new Date() ? 'site-unverified' : r.availability}));
    const selectedRace = candidacyId == null ? null : raceResults.find(r => r.candidacy_id === candidacyId);
    let availability = visibleItems.length ? 'available' : null;
    if (!availability && scope.offices.length===1 && scope.offices[0]==='house' && !geography) availability='geography-unverified';
    else if (!availability && knownEmpty) availability='no-race';
    else if (!availability && races.length===0) availability='coverage-unknown';
    else if (!availability && selectedRace && !['available','no-positions'].includes(selectedRace.availability)) availability=selectedRace.availability;
    else if (!availability && selectedRace?.availability==='no-positions') availability='no-positions';
    else if (!availability && policyArea != null && scopedItems.length>0) availability='no-topic-match';
    else if (!availability) availability='coverage-unknown';
    const alignment = userId == null || candidacyId == null ? null : scopedItems.reduce((counts,item) => {
      if (item.response?.stance==='approve') counts.agreementCount += 1;
      if (item.response?.stance==='disapprove') counts.disagreementCount += 1;
      return counts;
    },{agreementCount:0,disagreementCount:0});
    if (alignment) {
      alignment.answeredCount=alignment.agreementCount+alignment.disagreementCount;
      alignment.percentage=alignment.answeredCount ? Math.round(alignment.agreementCount/alignment.answeredCount*100) : null;
      alignment.status=alignment.answeredCount ? 'ready' : 'no-answers';
    }
    return {scope,coverage:coverageSummary(coverage,state,scope.offices,Boolean(geography)),houseAvailability:geography ? null : 'geography-unverified',
      availability,races:raceResults,items:visibleItems.slice(offset,offset+limit),policyCounts,alignment,
      snapshotId:binding,
      nextCursor:offset+limit<visibleItems.length ? Buffer.from(JSON.stringify({binding,offset:offset+limit})).toString('base64url') : null};
  });
}
