// Read-only preflight by default. `--apply` imports the selected-state research
// database into local VoteFeed PostgreSQL and the guarded VoteFeed Dev project.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from '../server/node_modules/pg/lib/index.js';
import dotenv from '../server/node_modules/dotenv/lib/main.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const researchDb = path.join(root, 'data/elections-2026-site-completeness/elections_2026_ca_pa_oh_ma_nj_ny_ballot_first_site_research.sqlite');
const localDatabase = 'votefeed_fec_candidates_2026_local';
const localPort = Number(process.env.VOTEFEED_LOCAL_PG_PORT ?? 5432);
const expectedProjectRef = 'kddqnmenstoilnzwajnb';
const apply = process.argv.includes('--apply');

const python = [
  'import json, sqlite3, sys',
  'c = sqlite3.connect(sys.argv[1])',
  "print(json.dumps([json.loads(r[0]) for r in c.execute('select raw_record_json from candidate_research order by state, office, district, official_candidate_name')], ensure_ascii=False))",
].join('\n');
const records = JSON.parse(execFileSync('py', ['-c', python, researchDb], {
  cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, PYTHONUTF8: '1' },
}));

const hash = value => createHash('sha256').update(value).digest('hex');
function deterministicUuid(value) {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function jsonArray(value) {
  if (!value) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}
function clean(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function iso(value) {
  const date = value ? new Date(value) : new Date('2026-10-29T00:00:00.000Z');
  if (!Number.isFinite(date.getTime())) return new Date('2026-10-29T00:00:00.000Z').toISOString();
  return date.toISOString();
}
function reviewUntil(value) {
  return new Date(new Date(iso(value)).getTime() + 45 * 24 * 60 * 60 * 1000).toISOString();
}
function httpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch { return null; }
}
function destination(url) {
  const parsed = httpUrl(url);
  return parsed ? { origin: parsed.origin, pathPrefix: '/' } : null;
}

if (records.length !== 305 || records.some(row => row.state === 'FL')) {
  throw new Error(`Expected 305 non-Florida candidates in the unified research database; found ${records.length}`);
}
const keys = new Set(records.map(row => row.source_candidate_key));
if (keys.size !== records.length || records.some(row => !row.source_candidate_key)) {
  throw new Error('Research database has missing or duplicate official candidate keys');
}
const stateCodes = [...new Set(records.map(row => row.state))].sort();
const exactFecCount = records.filter(row => row.crosswalk_status === 'matched' && clean(row.fec_candidate_id)).length;
const stateIdentityCount = records.length - exactFecCount;
const displayableCandidateCount = records.filter(row => row.frontend_display_status === 'on-ballot').length;
const writeInOnlyCount = records.length - displayableCandidateCount;
const positionCount = records.reduce((sum, row) => sum + jsonArray(row.issue_positions_json).length, 0);
const readyPositionCount = records.reduce((sum, row) => sum + jsonArray(row.issue_positions_json).filter(pos => pos.status === 'ready').length, 0);
const reviewPositionCount = positionCount - readyPositionCount;

function raceFor(row) {
  return {
    office: row.office,
    state: row.state,
    district: row.office === 'house' ? Number(row.district) : null,
    senateSeat: row.office === 'senate' ? Number(row.senate_seat) : null,
    electionDate: row.election_date,
    stage: 'general',
    contestType: row.contest_type,
  };
}
function raceRecord(row) {
  const race = raceFor(row);
  const id = deterministicUuid(`race:${JSON.stringify(race)}`);
  const ohioSenateSpecial = race.state === 'OH' && race.office === 'senate' && race.contestType === 'special';
  return {
    id, office: race.office, state: race.state, district: race.district,
    senate_seat: race.senateSeat, election_date: race.electionDate,
    stage: race.stage, contest_type: race.contestType,
    evidence: ohioSenateSpecial ? {
      url: 'https://www.ohiosos.gov/globalassets/elections/directives/2025/directive-2025-54---writ-of-special-election-for-united-states-senate-election.pdf',
      checkedAt: '2025-11-13T00:00:00.000Z',
      sourceTitle: 'Ohio Secretary of State Directive 2025-54: Special United States Senate Election',
      contestType: 'special',
      senateSeat: 3,
      termEnds: '2029-01-03',
      officialCandidateList: {
        url: row.ballot_source_url,
        title: row.ballot_source_title,
        checkedAt: iso(row.ballot_source_retrieved_at),
        sourceCandidateKey: row.source_candidate_key,
      },
    } : {
      url: row.ballot_source_url,
      checkedAt: iso(row.ballot_source_retrieved_at),
      sourceTitle: row.ballot_source_title,
      sourceCandidateKey: row.source_candidate_key,
    },
  };
}
const races = [...new Map(records.map(row => {
  const race = raceRecord(row);
  return [JSON.stringify([race.office,race.state,race.district,race.senate_seat,race.election_date,race.stage,race.contest_type]),race];
})).values()];

const racePayload = JSON.stringify(races);
const candidatePayload = JSON.stringify(records.map(row => ({
  ...row,
  _stateCandidateId: deterministicUuid(`official-candidate:${row.source_candidate_key}`),
})));

function siteStageFor(row) {
  const pageRecords = jsonArray(row.issue_pages_json);
  const issueOrigins = pageRecords.map(page => destination(page.url)).filter(Boolean);
  const siteUrl = clean(row.campaign_site_url) ?? clean(row.homepage_url);
  const parsedSite = httpUrl(siteUrl);
  const recordedStatus = clean(row.campaign_site_status);
  let status = recordedStatus === 'verified' && parsedSite ? 'verified'
    : recordedStatus === 'unreachable' && parsedSite ? 'ambiguous' : 'missing';
  if (recordedStatus === 'verified' && !parsedSite) throw new Error(`Verified site has invalid URL for ${row.source_candidate_key}`);
  const checkedAt = iso(row.site_reviewed_at ?? row.site_evidence_url ?? row.ballot_source_retrieved_at);
  const allowed = new Map();
  for (const item of [destination(parsedSite?.toString()), ...issueOrigins]) {
    if (item) allowed.set(item.origin, item);
  }
  const reviewData = {
    ...row,
    sourceCandidateKey: row.source_candidate_key,
    importedBy: 'ballot-first-research-v1',
    ballotEvidence: {
      status: row.ballot_status,
      url: row.ballot_source_url,
      title: row.ballot_source_title,
      retrievedAt: row.ballot_source_retrieved_at,
      page: row.ballot_source_page,
      excerpt: row.ballot_source_excerpt,
      limitations: row.ballot_source_limitations,
    },
  };
  return {
    source_candidate_key: row.source_candidate_key,
    id: deterministicUuid(`campaign-site:${row.source_candidate_key}`),
    proposed_url: status === 'missing' ? null : parsedSite.toString(),
    status,
    approved_destinations: status === 'verified' ? [...allowed.values()] : [],
    checked_at: checkedAt,
    review_after: status === 'missing' ? null : reviewUntil(checkedAt),
    invalidation_reason: status === 'missing' ? 'no-campaign-site-found'
      : status === 'ambiguous' ? 'homepage-unreachable-in-research-review' : null,
    evidence: {
      url: clean(row.site_evidence_url) ?? clean(row.homepage_url) ?? clean(row.ballot_source_url),
      excerpt: clean(row.site_evidence_excerpt) ?? clean(row.site_evidence_title) ?? 'Campaign site review is recorded in the ballot-first research dataset.',
      method: clean(row.site_review_method) ?? clean(row.homepage_review_method) ?? 'Ballot-first campaign-site review',
      verifierVersion: 'ballot-first-campaign-site-review-v1',
      checkedAt,
      sourceCandidateKey: row.source_candidate_key,
      research: reviewData,
    },
  };
}

function issueSourceGroups(row) {
  const positionRows = jsonArray(row.issue_positions_json);
  const pageRows = jsonArray(row.issue_pages_json);
  const pages = new Map(pageRows.filter(page => clean(page.url)).map(page => [page.url, page]));
  const groups = new Map();
  for (const position of positionRows) {
    const url = clean(position.page_url);
    if (!url) continue;
    if (!groups.has(url)) groups.set(url, []);
    groups.get(url).push(position);
  }
  const site = siteStageFor(row);
  if (site.status !== 'verified') return [];
  const output = [];
  for (const [pageUrl, positions] of groups) {
    const pageUrlObject = httpUrl(pageUrl);
    if (!pageUrlObject) continue;
    const page = pages.get(pageUrl) ?? {};
    const excerpts = [...new Set(positions.map(pos => clean(pos.excerpt)).filter(Boolean))];
    const sourceText = [clean(page.full_text), ...excerpts].filter(Boolean).join('\n\n');
    if (!sourceText) continue;
    const fingerprint = hash(sourceText);
    const retrievedAt = iso(page.retrieved_at ?? row.issue_discovery_reviewed_at ?? row.site_reviewed_at ?? row.ballot_source_retrieved_at);
    const sourceId = deterministicUuid(`campaign-source:${row.source_candidate_key}:${pageUrl}:${fingerprint}`);
    const attemptId = deterministicUuid(`campaign-import-attempt:${row.source_candidate_key}:${pageUrl}:${fingerprint}`);
    output.push({
      source_candidate_key: row.source_candidate_key,
      page_url: pageUrl,
      site_id: site.id,
      source_id: sourceId,
      attempt_id: attemptId,
      requested_url: pageUrl,
      final_url: pageUrl,
      retrieved_at: retrievedAt,
      source_text: sourceText,
      fingerprint,
      page_title: clean(page.page_title),
      page_status: clean(page.page_status),
      page_notes: clean(page.notes),
      positions,
      verification_evidence: {
        sourceType: 'first-party campaign page research record',
        sourceCandidateKey: row.source_candidate_key,
        sourceUrl: pageUrl,
        pageTitle: clean(page.page_title),
        pageStatus: clean(page.page_status),
        discoveryQuery: clean(page.discovery_query),
        retrievedAt,
        excerpts,
        researchDataset: '2026 ballot-first campaign-site completeness',
      },
    });
  }
  return output;
}

const sites = records.map(siteStageFor);
const sourceGroups = records.flatMap(issueSourceGroups);
const positionsWithVerifiedSite = sourceGroups.reduce((sum,group) => sum + group.positions.length,0);
const readyPositionsWithVerifiedSite = sourceGroups.reduce((sum,group) => sum + group.positions.filter(pos => pos.status === 'ready').length,0);
const allowedTopics = new Set(['economy','healthcare','housing','education','environment','immigration','civil-rights','public-safety','foreign-policy','government','other']);
const positionInputs = [];
for (const group of sourceGroups) {
  for (const position of group.positions) {
    if (!['ready','review'].includes(position.status)) continue;
    if (!allowedTopics.has(position.topic) || !clean(position.claim_text) || !clean(position.summary) || !clean(position.excerpt)
      || position.summary.length > 500) throw new Error(`Invalid issue position in ${group.source_candidate_key}: ${position.position_id}`);
    positionInputs.push({
      source_candidate_key: group.source_candidate_key,
      page_url: group.page_url,
      source_id: group.source_id,
      attempt_id: group.attempt_id,
      position_id: String(position.position_id),
      claim_id: deterministicUuid(`campaign-claim:${group.source_candidate_key}:${position.position_id}`),
      topic: position.topic,
      claim_text: position.claim_text,
      summary: position.summary,
      excerpt: position.excerpt,
      research_status: position.status,
      review_notes: position.review_notes ?? null,
      record_json: position,
      page_title: group.page_title,
    });
  }
}

const env = dotenv.parse(await readFile(path.join(root, 'server/.env')));
if (!env.DATABASE_URL) throw new Error('server/.env does not define DATABASE_URL');
const targetUrl = new URL(env.DATABASE_URL);
if (!targetUrl.username.includes(expectedProjectRef) && !targetUrl.hostname.includes(expectedProjectRef)) {
  throw new Error('server/.env DATABASE_URL is not the expected VoteFeed Dev project');
}
if (targetUrl.hostname.includes('ycaldyqnmitdajoguagi')) throw new Error('Refusing to connect to production');

const local = new pg.Client({host:'127.0.0.1',port:localPort,user:'postgres',database:localDatabase,ssl:false});
const target = new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});

async function status(client) {
  const database = (await client.query('select current_database() as database')).rows[0].database;
  const existing = await client.query(`select
    (select count(*)::int from public.election_candidacies c join public.election_races r on r.id=c.race_id
      where r.state=any($1::text[]) and r.election_date='2026-11-03' and c.eligibility='ballot-confirmed') as ballot_confirmed,
    (select count(*)::int from public.campaign_sites) as campaign_sites,
    (select count(*)::int from public.campaign_sources) as campaign_sources,
    (select count(*)::int from public.campaign_position_versions) as position_versions`,[stateCodes]);
  return {database,...existing.rows[0]};
}

async function importInto(client, label) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL statement_timeout='180s'");
    await client.query('CREATE TEMP TABLE ballot_research_stage(payload jsonb NOT NULL) ON COMMIT DROP');
    await client.query('INSERT INTO ballot_research_stage(payload) SELECT value FROM jsonb_array_elements($1::jsonb)',[candidatePayload]);

    await client.query(`INSERT INTO public.election_races(id,office,state,district,senate_seat,election_date,stage,contest_type,evidence)
      SELECT x.id,x.office,x.state,x.district,x.senate_seat,x.election_date,x.stage,x.contest_type,x.evidence
      FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,office text,state text,district integer,senate_seat integer,election_date date,stage text,contest_type text,evidence jsonb)
      ON CONFLICT DO NOTHING`,[racePayload]);

    await client.query(`INSERT INTO public.election_candidates(id,name,match_status,match_evidence)
      SELECT (s.payload->>'_stateCandidateId')::uuid,s.payload->>'official_candidate_name','unresolved',
        jsonb_build_object('officialStateList',jsonb_build_object('state',s.payload->>'state','url',s.payload->>'ballot_source_url',
          'checkedAt',s.payload->>'ballot_source_retrieved_at','sourceCandidateKey',s.payload->>'source_candidate_key'))
      FROM ballot_research_stage s
      WHERE NOT (s.payload->>'crosswalk_status'='matched' AND nullif(s.payload->>'fec_candidate_id','') IS NOT NULL)
      ON CONFLICT(id) DO NOTHING`);
    await client.query(`INSERT INTO public.election_candidate_identities(system,source_id,candidate_id,evidence)
      SELECT 'state:'||(s.payload->>'state')||':official-list',s.payload->>'source_candidate_key',(s.payload->>'_stateCandidateId')::uuid,
        jsonb_build_object('url',s.payload->>'ballot_source_url','checkedAt',s.payload->>'ballot_source_retrieved_at',
          'sourceTitle',s.payload->>'ballot_source_title','sourceType',s.payload->>'ballot_source_type')
      FROM ballot_research_stage s
      WHERE NOT (s.payload->>'crosswalk_status'='matched' AND nullif(s.payload->>'fec_candidate_id','') IS NOT NULL)
      ON CONFLICT(system,source_id) DO NOTHING`);

    await client.query(`CREATE TEMP TABLE ballot_research_resolved ON COMMIT DROP AS
      SELECT s.payload,s.payload->>'source_candidate_key' AS source_candidate_key,
        coalesce(fi.candidate_id,si.candidate_id) AS candidate_id,r.id AS race_id
      FROM ballot_research_stage s
      LEFT JOIN public.election_candidate_identities fi ON fi.system='fec:candidate'
        AND fi.source_id=s.payload->>'fec_candidate_id'
        AND s.payload->>'crosswalk_status'='matched' AND nullif(s.payload->>'fec_candidate_id','') IS NOT NULL
      LEFT JOIN public.election_candidate_identities si ON si.system='state:'||(s.payload->>'state')||':official-list'
        AND si.source_id=s.payload->>'source_candidate_key'
      JOIN public.election_races r ON r.state=s.payload->>'state' AND r.office=s.payload->>'office'
        AND r.election_date=(s.payload->>'election_date')::date AND r.stage='general'
        AND r.contest_type=s.payload->>'contest_type'
        AND r.district IS NOT DISTINCT FROM nullif(s.payload->>'district','')::integer
        AND r.senate_seat IS NOT DISTINCT FROM nullif(s.payload->>'senate_seat','')::integer
      `);
    const unresolved = await client.query(`select count(*)::int as count from ballot_research_resolved
      where candidate_id is null or race_id is null`);
    if (unresolved.rows[0].count) throw new Error(`${unresolved.rows[0].count} candidate-to-race links could not be resolved in ${label}`);

    await client.query(`INSERT INTO public.election_candidacies(candidate_id,race_id,party,eligibility,eligibility_evidence)
      SELECT rr.candidate_id,rr.race_id,nullif(rr.payload->>'fec_party_code',''),
        CASE WHEN rr.payload->>'frontend_display_status'='write-in-only' THEN 'filed' ELSE 'ballot-confirmed' END,
        jsonb_build_object('system','state:'||(rr.payload->>'state')||':official-list','url',rr.payload->>'ballot_source_url',
          'checkedAt',rr.payload->>'ballot_source_retrieved_at','sourceCandidateKey',rr.source_candidate_key,
          'candidateName',rr.payload->>'official_candidate_name','candidateStatus',rr.payload->>'official_candidate_status',
          'ballotStatus',rr.payload->>'ballot_status','sourceType',rr.payload->>'ballot_source_type',
          'sourceTitle',rr.payload->>'ballot_source_title','sourcePage',nullif(rr.payload->>'ballot_source_page','')::integer,
          'sourceExcerpt',rr.payload->>'ballot_source_excerpt','sourceLimitations',rr.payload->>'ballot_source_limitations',
          'crosswalkStatus',rr.payload->>'crosswalk_status','crosswalkNotes',rr.payload->>'crosswalk_notes',
          'contestType',rr.payload->>'contest_type','senateSeat',nullif(rr.payload->>'senate_seat','')::integer,
          'frontendDisplayStatus',rr.payload->>'frontend_display_status',
          'researchDataset','2026 ballot-first selected-state campaign-site completeness')
      FROM ballot_research_resolved rr
      ON CONFLICT(candidate_id,race_id) DO UPDATE SET party=coalesce(EXCLUDED.party,public.election_candidacies.party),
        eligibility=EXCLUDED.eligibility,eligibility_evidence=EXCLUDED.eligibility_evidence,updated_at=now()`);
    await client.query('ALTER TABLE ballot_research_resolved ADD COLUMN candidacy_id uuid');
    await client.query(`UPDATE ballot_research_resolved rr SET candidacy_id=c.id
      FROM public.election_candidacies c WHERE c.candidate_id=rr.candidate_id AND c.race_id=rr.race_id`);
    const unresolvedCandidacies = await client.query(`select count(*)::int as count from ballot_research_resolved where candidacy_id is null`);
    if (unresolvedCandidacies.rows[0].count) throw new Error(`${unresolvedCandidacies.rows[0].count} candidacies could not be resolved in ${label}`);
    await client.query(`UPDATE public.election_candidate_identities fi SET evidence=fi.evidence || jsonb_build_object('officialBallotCrosswalk',
        jsonb_build_object('sourceCandidateKey',rr.source_candidate_key,'url',rr.payload->>'ballot_source_url',
          'checkedAt',rr.payload->>'ballot_source_retrieved_at','matchStatus',rr.payload->>'crosswalk_status',
          'matchMethod',rr.payload->>'crosswalk_method'))
      FROM ballot_research_resolved rr WHERE rr.payload->>'crosswalk_status'='matched'
        AND fi.system='fec:candidate' AND fi.source_id=rr.payload->>'fec_candidate_id'`);

    const existingSite = await client.query(`SELECT rr.source_candidate_key,s.id,s.evidence->>'sourceCandidateKey' AS source_key
      FROM ballot_research_resolved rr JOIN public.campaign_sites s ON s.candidacy_id=rr.candidacy_id AND s.is_current
      WHERE s.evidence->>'sourceCandidateKey' IS DISTINCT FROM rr.source_candidate_key`);
    if (existingSite.rowCount) throw new Error(`Refusing to replace an unrelated current campaign site in ${label}`);
    await client.query(`INSERT INTO public.campaign_sites(id,candidacy_id,revision,proposed_url,status,approved_destinations,evidence,checked_at,review_after,invalidation_reason)
      SELECT x.id,rr.candidacy_id,coalesce((SELECT max(old.revision)+1 FROM public.campaign_sites old WHERE old.candidacy_id=rr.candidacy_id),1),
        x.proposed_url,x.status,x.approved_destinations,x.evidence,x.checked_at,x.review_after,x.invalidation_reason
      FROM jsonb_to_recordset($1::jsonb) AS x(source_candidate_key text,id uuid,proposed_url text,status text,
        approved_destinations jsonb,evidence jsonb,checked_at timestamptz,review_after timestamptz,invalidation_reason text)
      JOIN ballot_research_resolved rr USING(source_candidate_key)
      ON CONFLICT(id) DO NOTHING`,[JSON.stringify(sites)]);

    const sourcesPayload = JSON.stringify(sourceGroups.map(group => ({
      source_candidate_key: group.source_candidate_key, source_id: group.source_id, site_id: group.site_id,
      page_url: group.page_url, retrieved_at: group.retrieved_at, source_text: group.source_text,
      fingerprint: group.fingerprint, verification_evidence: group.verification_evidence,
    })));
    if (sourceGroups.length) {
      await client.query(`INSERT INTO public.campaign_sources(id,candidacy_id,site_id,requested_url,final_url,retrieved_at,source_text,fingerprint,verification_evidence)
        SELECT x.source_id,rr.candidacy_id,x.site_id,x.page_url,x.page_url,x.retrieved_at,x.source_text,x.fingerprint,x.verification_evidence
        FROM jsonb_to_recordset($1::jsonb) AS x(source_candidate_key text,source_id uuid,site_id uuid,page_url text,
          retrieved_at timestamptz,source_text text,fingerprint text,verification_evidence jsonb)
        JOIN ballot_research_resolved rr USING(source_candidate_key)
        JOIN public.campaign_sites w ON w.id=x.site_id AND w.candidacy_id=rr.candidacy_id AND w.is_current
          AND w.status='verified' AND w.review_after>now()
        ON CONFLICT DO NOTHING`,[sourcesPayload]);
      const attemptPayload = JSON.stringify(sourceGroups.map(group => ({
        source_candidate_key: group.source_candidate_key, source_id: group.source_id, attempt_id: group.attempt_id,
        page_url: group.page_url, validation: { source: 'ballot-first-research', status: 'reviewed' },
        reconciliation: { sourceCandidateKey: group.source_candidate_key, sourceUrl: group.page_url },
        status: group.positions.some(position => position.status !== 'ready') ? 'partial' : 'complete',
      })));
      await client.query(`INSERT INTO public.campaign_processing_attempts(id,candidacy_id,snapshot_id,status,model,prompt_version,validation,reconciliation)
        SELECT x.attempt_id,rr.candidacy_id,x.source_id,x.status,'human-curated-research','ballot-first-research-v1',x.validation,x.reconciliation
        FROM jsonb_to_recordset($1::jsonb) AS x(source_candidate_key text,source_id uuid,attempt_id uuid,status text,validation jsonb,reconciliation jsonb)
        JOIN ballot_research_resolved rr USING(source_candidate_key)
        JOIN public.campaign_sources cs ON cs.id=x.source_id AND cs.candidacy_id=rr.candidacy_id
        ON CONFLICT(id) DO NOTHING`,[attemptPayload]);
    }

    const resolvedRows = (await client.query(`SELECT source_candidate_key,candidacy_id FROM ballot_research_resolved ORDER BY source_candidate_key`)).rows;
    const candidacyByKey = new Map(resolvedRows.map(row => [row.source_candidate_key,row.candidacy_id]));
    const versionInputs = [];
    const evidenceInputs = [];
    const groupsByKey = new Map(sourceGroups.map(group => [`${group.source_candidate_key}\n${group.page_url}`,group]));
    for (const position of positionInputs) {
      const candidacyId = candidacyByKey.get(position.source_candidate_key);
      if (!candidacyId) continue;
      const group = groupsByKey.get(`${position.source_candidate_key}\n${position.page_url}`);
      if (!group || !group.source_text.includes(position.excerpt)) continue;
      const versionKey = hash(JSON.stringify([candidacyId,position.claim_id,position.claim_text]));
      const isReady = position.research_status === 'ready';
      const validation = {
        outcome: isReady ? 'valid' : 'review',
        validatorVersion: 'ballot-first-human-review-v1',
        reasons: isReady ? [] : [clean(position.review_notes) ?? 'Retained for human review'],
      };
      versionInputs.push({
        source_candidate_key: position.source_candidate_key,
        candidacy_id: candidacyId,
        claim_id: position.claim_id,
        source_id: position.source_id,
        version_id: deterministicUuid(`campaign-position-version:${versionKey}`),
        version_key: versionKey,
        claim_text: position.claim_text,
        topic: position.topic,
        summary: position.summary,
        excerpt: position.excerpt,
        state: isReady ? 'published' : 'withheld',
        validation,
      });
      evidenceInputs.push({
        version_key: versionKey,
        source_id: position.source_id,
        attempt_id: position.attempt_id,
        presentation: {
          topic: position.topic,
          summary: position.summary,
          excerpt: position.excerpt,
          researchStatus: position.research_status,
          reviewNotes: position.review_notes,
          pageTitle: position.page_title,
          sourceCandidateKey: position.source_candidate_key,
          sourcePosition: position.record_json,
        },
      });
    }
    await client.query(`INSERT INTO public.campaign_claims(id,candidacy_id)
      SELECT x.claim_id,x.candidacy_id FROM jsonb_to_recordset($1::jsonb) AS x(claim_id uuid,candidacy_id uuid)
      ON CONFLICT(id) DO NOTHING`,[JSON.stringify(versionInputs.map(x => ({claim_id:x.claim_id,candidacy_id:x.candidacy_id})))]);
    if (versionInputs.length) {
      await client.query(`INSERT INTO public.campaign_position_versions(id,candidacy_id,claim_id,snapshot_id,version_key,claim_text,topic,summary,excerpt,state,model,prompt_version,validation)
        SELECT x.version_id,x.candidacy_id,x.claim_id,x.source_id,x.version_key,x.claim_text,x.topic,x.summary,x.excerpt,x.state,
          'human-curated-research','ballot-first-research-v1',x.validation
        FROM jsonb_to_recordset($1::jsonb) AS x(version_id uuid,candidacy_id uuid,claim_id uuid,source_id uuid,version_key text,
          claim_text text,topic text,summary text,excerpt text,state text,validation jsonb)
        ON CONFLICT(version_key) DO NOTHING`,[JSON.stringify(versionInputs)]);
      await client.query(`INSERT INTO public.campaign_position_evidence(position_version_id,snapshot_id,attempt_id,presentation)
        SELECT p.id,x.source_id,x.attempt_id,x.presentation
        FROM jsonb_to_recordset($1::jsonb) AS x(version_key text,source_id uuid,attempt_id uuid,presentation jsonb)
        JOIN public.campaign_position_versions p ON p.version_key=x.version_key
        JOIN public.campaign_processing_attempts a ON a.id=x.attempt_id
        ON CONFLICT DO NOTHING`,[JSON.stringify(evidenceInputs)]);
    }
    await client.query(`UPDATE public.election_candidacies c SET
        availability=CASE WHEN EXISTS(SELECT 1 FROM public.campaign_position_versions p WHERE p.candidacy_id=c.id AND p.state='published') THEN 'available'
          WHEN rr.payload->>'issue_review_status'='no-policy' THEN 'no-positions' ELSE 'pending' END,
        updated_at=now()
      FROM ballot_research_resolved rr WHERE c.id=rr.candidacy_id`);

    const report = await client.query(`SELECT r.state,r.office,r.contest_type,c.eligibility,count(DISTINCT rr.candidacy_id)::int AS candidates,
        count(DISTINCT s.id)::int AS site_reviews,
        count(DISTINCT p.id) FILTER (WHERE p.state='published')::int AS published_positions,
        count(DISTINCT p.id) FILTER (WHERE p.state='withheld')::int AS withheld_positions
      FROM ballot_research_resolved rr JOIN public.election_candidacies c ON c.id=rr.candidacy_id
      JOIN public.election_races r ON r.id=c.race_id
      LEFT JOIN public.campaign_sites s ON s.candidacy_id=c.id AND s.is_current
      LEFT JOIN public.campaign_position_versions p ON p.candidacy_id=c.id
      GROUP BY r.state,r.office,r.contest_type,c.eligibility ORDER BY r.state,r.office,r.contest_type`);
    const included = await client.query(`SELECT count(DISTINCT rr.candidacy_id)::int AS candidates,
        count(DISTINCT p.id) FILTER (WHERE p.state='published')::int AS published_positions,
        count(DISTINCT p.id) FILTER (WHERE p.state='withheld')::int AS withheld_positions,
        count(DISTINCT s.id) FILTER (WHERE s.status='verified')::int AS verified_sites,
        count(DISTINCT s.id) FILTER (WHERE s.status='missing')::int AS missing_sites,
        count(DISTINCT s.id) FILTER (WHERE s.status='ambiguous')::int AS ambiguous_sites
      FROM ballot_research_resolved rr LEFT JOIN public.campaign_sites s ON s.candidacy_id=rr.candidacy_id AND s.is_current
      LEFT JOIN public.campaign_position_versions p ON p.candidacy_id=rr.candidacy_id`);
    await client.query('COMMIT');
    return {label,totals:included.rows[0],byRace:report.rows};
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

try {
  await Promise.all([local.connect(),target.connect()]);
  const before = await Promise.all([status(local),status(target)]);
  const preview = {
    mode: apply ? 'apply' : 'preflight',
    devProject: expectedProjectRef,
    researchDb: path.relative(root,researchDb),
    source: {candidates:records.length,displayableCandidates:displayableCandidateCount,writeInOnlyCandidates:writeInOnlyCount,
      states:stateCodes,exactFecCrosswalks:exactFecCount,stateSourceIdentities:stateIdentityCount,
      races:races.length,issuePages:records.reduce((n,row)=>n+jsonArray(row.issue_pages_json).length,0),
      issuePositions:positionCount,readyPositions:readyPositionCount,reviewPositions:reviewPositionCount,
      positionsWithVerifiedCampaignSite:positionsWithVerifiedSite,
      readyPositionsWithVerifiedCampaignSite:readyPositionsWithVerifiedSite,
      campaignSourcesToImport:sourceGroups.length,floridaRows:0},
    before,
  };
  if (!apply) {
    process.stdout.write(JSON.stringify(preview,null,2)+'\n');
  } else {
    const [devImport,localImport] = await Promise.all([
      importInto(target,'VoteFeed Dev'), importInto(local,'local PostgreSQL'),
    ]);
    process.stdout.write(JSON.stringify({...preview,imports:[devImport,localImport]},null,2)+'\n');
  }
} finally {
  await Promise.allSettled([local.end(),target.end()]);
}
