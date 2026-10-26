import { createHash } from 'node:crypto';
import db from '../client.js';
import { RELEASE_SCOPE, normalizeRace, normalizeState, normalizeDistrict, validateExtractionItem, positionVersionKey } from '../../elections/contracts.js';

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
  return { ...scope, states: [...new Set(scope.states)].sort(), offices: [...new Set(scope.offices)].sort() };
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
      ON CONFLICT(system,source_id) DO UPDATE SET evidence=EXCLUDED.evidence`, [identity.system, identity.id, id, identity.evidence]);
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
        && (current.status !== 'verified' || new Date(current.review_after)>new Date())) return current;
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
      AND status='verified' AND review_after>now() FOR SHARE`, [input.siteId,input.candidacyId]);
    if (!site || !approved(input.requestedUrl,site.approved_destinations) || !approved(input.finalUrl,site.approved_destinations)) throw new Error('Verified approved campaign destination required');
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
      !(input.coverage ?? []).some(entry=>entry.state===state && entry.office===office && entry.status==='complete')))) throw new Error('Complete coverage evidence required for every requested state/office');
  }
  return one(runner, `UPDATE election_ingestion_runs SET status=$2,counts=$3,coverage=$4,error_codes=$5,finished_at=now()
    WHERE id=$1 AND status='pending' RETURNING *`, [id,input.status,input.counts ?? {},JSON.stringify(input.coverage ?? []),JSON.stringify(input.errorCodes ?? [])]);
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
      WHERE s.id=$1 AND s.candidacy_id=$2 AND w.is_current AND w.status='verified' AND w.review_after>now() FOR SHARE OF w`, [input.snapshotId,input.candidacyId]);
    if (!source) throw new Error('Current verified snapshot required');
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
  return one(runner, `INSERT INTO election_geography_evidence(state,cycle,boundary_version,source_url,checked_at,status)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [normalizeState(input.state),input.cycle,input.boundaryVersion,input.sourceUrl,input.checkedAt,input.status]);
}

// Only trusted server code supplies auth.clerkUserId (req.auth().userId).
// Never accept a user ID from a request body/query or trust req.user without Clerk.
async function owner(auth, runner, optional = false) {
  if (!auth?.clerkUserId) { if (optional) return null; throw new Error('Authentication required'); }
  const user = await one(runner,'SELECT id FROM users WHERE clerk_user_id=$1',[auth.clerkUserId]);
  if (!user || auth.userId != null && auth.userId !== user.id) throw new Error('Authenticated user mapping mismatch');
  return user.id;
}
export async function saveElectionResponse(auth, input, runner = db) {
  const userId = await owner(auth,runner);
  if ('userId' in input || 'user_id' in input) throw new Error('Client ownership override forbidden');
  return one(runner, `INSERT INTO election_interactions(user_id,position_version_id,stance,private_comment) VALUES($1,$2,$3,$4)
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

export async function readElectionPositions(input, auth = null, pool = db) {
  const scope = scopeOf(input.scope), state = normalizeState(input.state);
  const district = input.district == null ? null : normalizeDistrict(input.district);
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit<1 || limit>50) throw new TypeError('Limit must be 1–50');
  return transaction(pool, async c => {
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const userId = await owner(auth,c,true);
    const geography = input.geographyEvidenceId ? await one(c, `SELECT id FROM election_geography_evidence
      WHERE id=$1 AND state=$2 AND cycle=$3 AND status='verified'`,[input.geographyEvidenceId,state,scope.cycle]) : null;
    const races = (await c.query(`SELECT r.*,co.id AS candidacy_id,co.availability,co.last_attempt_at,co.last_success_at,co.failure_code,
      co.eligibility,w.status AS site_status,w.review_after,w.id AS site_id
      FROM election_races r LEFT JOIN election_candidacies co ON co.race_id=r.id
      LEFT JOIN campaign_sites w ON w.candidacy_id=co.id AND w.is_current
      WHERE r.state=$1 AND r.state=ANY($2::text[]) AND r.office=ANY($3::text[]) AND extract(year FROM r.election_date)=$4
      AND r.stage=$5 AND r.contest_type=$6 AND (r.office='senate' OR ($7::boolean AND r.district=$8))
      ORDER BY r.election_date,r.state,r.office,COALESCE(r.district,r.senate_seat),r.id,co.candidate_id`,
    [state,scope.states,scope.offices,scope.cycle,scope.stage,scope.contestType,Boolean(geography),district])).rows;
    const items = (await c.query(`SELECT p.id AS "positionVersionId",p.claim_id AS "claimId",p.candidacy_id AS "candidacyId",p.topic,p.summary,p.excerpt,
      jsonb_build_object('id',ca.id,'name',ca.name,'party',co.party) AS candidate,
      to_jsonb(r) AS race,jsonb_build_object('snapshotId',s.id,'url',s.final_url,'retrievedAt',s.retrieved_at) AS source,
      co.eligibility AS "ballotStatus",
      CASE WHEN EXISTS(SELECT 1 FROM election_candidate_identities fi WHERE fi.candidate_id=ca.id AND fi.system='fec:candidate')
        THEN 'fec-registered' ELSE 'state-listed' END AS "registrationStatus",
      co.availability,CASE WHEN i.id IS NULL THEN NULL ELSE jsonb_build_object('stance',i.stance,'privateComment',i.private_comment) END AS response
      FROM campaign_position_versions p JOIN election_candidacies co ON co.id=p.candidacy_id
      JOIN election_candidates ca ON ca.id=co.candidate_id JOIN election_races r ON r.id=co.race_id
      JOIN campaign_sources s ON s.id=p.snapshot_id JOIN campaign_sites w ON w.candidacy_id=co.id AND w.is_current
      LEFT JOIN election_interactions i ON i.position_version_id=p.id AND i.user_id=$1
      WHERE r.id=ANY($2::uuid[]) AND (co.eligibility='ballot-confirmed' OR (co.eligibility NOT IN ('withdrawn','disqualified')
        AND EXISTS(SELECT 1 FROM election_candidate_identities fi WHERE fi.candidate_id=co.candidate_id AND fi.system='fec:candidate'))) AND w.status='verified' AND w.review_after>now()
      AND p.state='published' AND p.validation->>'outcome'='valid'
      AND EXISTS(SELECT 1 FROM campaign_position_evidence pe JOIN campaign_sources es ON es.id=pe.snapshot_id
        WHERE pe.position_version_id=p.id AND es.site_id=w.id AND es.candidacy_id=p.candidacy_id)
      ORDER BY r.election_date,r.state,r.office,COALESCE(r.district,r.senate_seat),r.id,ca.id,p.claim_id,p.id`,
    [userId,[...new Set(races.map(r=>r.id))]])).rows;
    const coverage = (await c.query(`SELECT status,coverage,finished_at FROM election_ingestion_runs WHERE stage='discovery' AND status<>'pending'
      AND scope @> $1::jsonb ORDER BY finished_at DESC,id DESC LIMIT 1`,[JSON.stringify({cycle:scope.cycle,stage:scope.stage,contestType:scope.contestType,states:[state],offices:scope.offices})])).rows[0] ?? null;
    // Cursor binds the complete visible publication set and filter; mutation forces restart.
    const binding = hash(JSON.stringify({scope,state,district,geography:geography?.id,userId,races,items}));
    let offset = 0;
    if (input.cursor) {
      let cursor;
      try { cursor=JSON.parse(Buffer.from(input.cursor,'base64url').toString()); } catch { throw new TypeError('Invalid cursor'); }
      if (cursor.binding!==binding || !Number.isInteger(cursor.offset) || cursor.offset<0 || cursor.offset>items.length) throw new Error('Publication changed or cursor invalid; restart read');
      offset=cursor.offset;
    }
    const knownEmpty = coverage?.status==='complete' && scope.offices.every(office=>
      (office!=='house' || geography) && coverage.coverage.some(entry => entry.state===state && entry.office===office && entry.status==='complete' && entry.noRaces===true));
    const raceResults = races.map(r => ({...r,availability: !r.candidacy_id ? 'pending' : !r.site_id || r.site_status==='missing' ? 'site-missing'
      : r.site_status!=='verified' || new Date(r.review_after)<=new Date() ? 'site-unverified' : r.availability}));
    return {scope,coverage:coverage ?? {status:'coverage-unknown'},houseAvailability:geography ? null : 'geography-unverified',
      availability:races.length ? null : knownEmpty ? 'no-race' : 'coverage-unknown',races:raceResults,items:items.slice(offset,offset+limit),
      nextCursor:offset+limit<items.length ? Buffer.from(JSON.stringify({binding,offset:offset+limit})).toString('base64url') : null};
  });
}
