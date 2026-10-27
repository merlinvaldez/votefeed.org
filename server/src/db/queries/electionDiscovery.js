import db from '../client.js';
import { upsertElectionCandidacy } from './elections.js';
import { isReleaseRace } from '../../elections/contracts.js';
import { sha256, stableJson, discoveryError, publicUrl } from '../../elections/discoveryUtils.js';

const one = async (c, sql, values) => (await c.query(sql, values)).rows[0];
async function transaction(pool, work) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const result = await work(c); await c.query('COMMIT'); return result; }
  catch (error) { await c.query('ROLLBACK'); throw error; }
  finally { c.release(); }
}
export async function saveElectionDocument(input, runner = db) {
  publicUrl(input.requestedUrl); publicUrl(input.finalUrl);
  if (!Buffer.isBuffer(input.bytes) || !input.bytes.length || input.bytes.length > 4_000_000
    || typeof input.text !== 'string' || input.text.length > 300_000 || !input.sourceKey || !input.system) throw discoveryError('discovery-invalid-document');
  const fingerprint = sha256(input.bytes), contextFingerprint = sha256(stableJson(input.context));
  await runner.query(`INSERT INTO election_source_documents(source_key,system,requested_url,final_url,retrieved_at,effective_at,
    media_type,content,source_text,fingerprint,context_fingerprint,context) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT(source_key,system,fingerprint,context_fingerprint) DO NOTHING`,
  [input.sourceKey,input.system,input.requestedUrl,input.finalUrl,input.retrievedAt,input.effectiveAt ?? null,
    input.mediaType,input.bytes,input.text,fingerprint,contextFingerprint,input.context]);
  return one(runner, `SELECT * FROM election_source_documents WHERE source_key=$1 AND system=$2 AND fingerprint=$3 AND context_fingerprint=$4`,
    [input.sourceKey,input.system,fingerprint,contextFingerprint]);
}
export async function saveElectionExtraction({documentId,runId=null,extractor,model=null,promptVersion,outcome,records=[],errorCode=null}, pool = db) {
  return transaction(pool, async c => {
    const attempt = await one(c, `INSERT INTO election_discovery_attempts(document_id,run_id,extractor,model,prompt_version,outcome,result)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [documentId,runId,extractor,model,promptVersion,outcome,{records,errorCode}]);
    const saved = [];
    for (const record of records) {
      const key = sha256(stableJson(record.data));
      const validationKey = sha256(stableJson({validation:record.validation,extractor,model,promptVersion}));
      await c.query(`INSERT INTO election_discovery_observations(document_id,record_key,validation_key,data,validation,attempt_id)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(document_id,record_key,validation_key) DO NOTHING`, [documentId,key,validationKey,record.data,record.validation,attempt.id]);
      saved.push(await one(c, 'SELECT * FROM election_discovery_observations WHERE document_id=$1 AND record_key=$2 AND validation_key=$3',[documentId,key,validationKey]));
    }
    return saved;
  });
}
export async function readDiscoveryObservation(id, runner = db) {
  return one(runner, `SELECT o.*,d.context,d.system,d.source_key,d.final_url,d.retrieved_at,d.effective_at
    FROM election_discovery_observations o JOIN election_source_documents d ON d.id=o.document_id WHERE o.id=$1`,[id]);
}

// FEC identities are resolved by source ID; name collisions require review.
export async function promoteElectionObservation(id, {actor='discovery-v1',candidateId=null,newPerson=false,review=null} = {}, pool = db) {
  return transaction(pool, async c => {
    const observation = await readDiscoveryObservation(id,c);
    if (!observation) throw discoveryError('discovery-observation-missing');
    const o = observation.data;
    if (observation.validation.outcome !== 'valid' || o.kind !== 'fec') throw discoveryError('discovery-unvalidated-observation');
    if (!actor || (candidateId || newPerson) && (!review?.url || !review?.reason)
      || candidateId && newPerson) throw discoveryError('discovery-resolution-evidence-required');
    if (review?.url) publicUrl(review.url);
    const identity = {system:'fec:candidate',id:o.fecId};
    const lock = identity ? stableJson(identity) : stableJson([observation.system,observation.source_key,observation.record_key]);
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[lock]);
    // Serialize same-race name collisions; a name is a review trigger, never a merge key.
    if (o.race) await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[stableJson([o.race,o.name.toLowerCase()])]);
    const prior = await one(c,'SELECT * FROM election_observation_resolutions WHERE observation_id=$1',[id]);
    if (prior) {
      if (candidateId && candidateId !== prior.candidate_id) throw discoveryError('discovery-resolution-conflict');
      return prior;
    }
    const known = identity ? await one(c,'SELECT candidate_id FROM election_candidate_identities WHERE system=$1 AND source_id=$2',[identity.system,identity.id]) : null;
    if (known && newPerson) throw discoveryError('discovery-identity-conflict');
    if (known && candidateId && known.candidate_id !== candidateId) throw discoveryError('discovery-identity-conflict');
    const same = (await c.query(`SELECT DISTINCT r.candidate_id FROM election_observation_resolutions r
      JOIN election_discovery_observations o ON o.id=r.observation_id JOIN election_source_documents d ON d.id=o.document_id
      WHERE d.system=$1 AND d.source_key=$2 AND o.record_key=$3`,[observation.system,observation.source_key,observation.record_key])).rows;
    if (same.length > 1) throw discoveryError('discovery-ambiguous-match');
    let person = known?.candidate_id ?? same[0]?.candidate_id ?? candidateId;
    if (candidateId && person !== candidateId) throw discoveryError('discovery-resolution-conflict');
    if (!person && o.race && !newPerson) {
      const collision = await one(c, `SELECT ca.id FROM election_candidates ca JOIN election_candidacies co ON co.candidate_id=ca.id
        JOIN election_races r ON r.id=co.race_id WHERE lower(ca.name)=lower($1) AND r.office=$2 AND r.state=$3
        AND r.district IS NOT DISTINCT FROM $4 AND r.senate_seat IS NOT DISTINCT FROM $5
        AND r.election_date=$6 AND r.stage=$7 AND r.contest_type=$8 LIMIT 1`,
      [o.name,o.race.office,o.race.state,o.race.district,o.race.senateSeat,o.race.electionDate,o.race.stage,o.race.contestType]);
      if (collision) throw discoveryError('discovery-match-review-required');
    }
    const method = candidateId || newPerson ? 'reviewed-evidence' : known ? o.kind === 'fec' || o.fecId ? 'fec-id' : 'official-id' : same.length ? 'same-record' : 'new-person';
    const evidence = {actor,url:observation.final_url,checkedAt:observation.retrieved_at,documentId:observation.document_id,observationId:id,review};
    if (!person) person = (await one(c, `INSERT INTO election_candidates(name,match_status,match_evidence) VALUES($1,$2,$3) RETURNING id`,
      [o.name,identity ? 'matched' : 'unresolved',evidence])).id;
    if (identity) await c.query(`INSERT INTO election_candidate_identities(system,source_id,candidate_id,evidence) VALUES($1,$2,$3,$4)
      ON CONFLICT(system,source_id) DO UPDATE SET evidence=EXCLUDED.evidence`,[identity.system,identity.id,person,evidence]);
    let candidacy = null;
    if (o.kind === 'fec' && o.race) {
      if (observation.system !== 'fec:discovery' || !isReleaseRace(o.race)) throw discoveryError('discovery-untrusted-fec');
      const result = await upsertElectionCandidacy({race:o.race,raceEvidence:{...evidence,basis:'fec-registration',ballotConfirmed:false},
        party:o.party,eligibility:'unknown',eligibilityEvidence:{...evidence,system:'fec:discovery'}},person,c);
      candidacy = result.candidacy.id;
    }
    return one(c, `INSERT INTO election_observation_resolutions(observation_id,candidate_id,candidacy_id,method,evidence)
      VALUES($1,$2,$3,$4,$5) RETURNING *`,[id,person,candidacy,method,evidence]);
  });
}
