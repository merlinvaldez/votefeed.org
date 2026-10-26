import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from '../server/node_modules/pg/lib/index.js';
import { syncCampaignPositions } from '../server/src/elections/syncCampaignPositions.js';
import {
  importElectionCandidate,
  saveCampaignSite,
  saveCampaignSnapshot,
  publishCampaignPositions,
  readElectionPositions,
  saveElectionResponse,
  recordCampaignFailure
} from '../server/src/db/queries/elections.js';
import { deterministicClaimId, VALIDATOR_VERSION } from '../server/src/elections/extractPositions.js';

test('campaign crawl, extraction, and atomic publication on disposable PostgreSQL', { skip: process.env.ELECTIONS_TEST_POSTGRES !== '1' }, async t => {
  const config = { host: '127.0.0.1', port: 55439, user: 'postgres', database: 'postgres', ssl: false };
  const admin = new pg.Client(config);
  await admin.connect();
  const database = `crawl_${randomUUID().replaceAll('-', '')}`;
  let pool;

  try {
    await admin.query(`CREATE DATABASE ${database}`);
    pool = new pg.Pool({ ...config, database });

    for (const role of ['anon', 'authenticated', 'service_role']) {
      await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
    }

    await pool.query(`
      CREATE TABLE users(id serial PRIMARY KEY, clerk_user_id text UNIQUE);
      CREATE TABLE reps(bioguideid text PRIMARY KEY);
      CREATE TABLE bills(id serial PRIMARY KEY, title text);
      INSERT INTO bills VALUES(1, 'Existing legislation');
    `);

    for (const name of ['20261026194547_elections_storage.sql', '20261026203305_election_discovery_observations.sql']) {
      await pool.query(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
    }

    const race = {
      office: 'house',
      state: 'WY',
      district: 0,
      electionDate: '2026-11-03',
      stage: 'general',
      contestType: 'regular'
    };

    let imported1, candidacy1, site1;
    let imported2, candidacy2, site2;

    await t.test('setup FEC-registered candidacies with verified campaign sites', async () => {
      const checkedAt = new Date().toISOString();
      const identityEvidence = { url: 'https://api.open.fec.gov/v1/candidates', checkedAt };
      const raceEvidence = { url: 'https://api.open.fec.gov/v1/candidates', checkedAt, basis: 'fec-registration', ballotConfirmed: false };

      // Candidate 1: FEC-registered
      imported1 = await importElectionCandidate({
        identity: { system: 'fec:candidate', id: 'H6WY00123', evidence: identityEvidence },
        name: 'Jane Candidate',
        race,
        raceEvidence,
        party: 'DEM',
        eligibility: 'unknown',
        eligibilityEvidence: { system: 'fec:candidate', id: 'H6WY00123' }
      }, pool);
      candidacy1 = imported1.candidacy;

      site1 = await saveCampaignSite({
        candidacyId: candidacy1.id,
        url: 'https://janecandidate.com',
        status: 'verified',
        approvedDestinations: [{ origin: 'https://janecandidate.com', pathPrefix: '/' }],
        evidence: {
          url: 'https://api.open.fec.gov/v1/committee/C00123456',
          excerpt: 'Official campaign committee website',
          method: 'fec-filing',
          verifierVersion: 'verifier-v1'
        },
        checkedAt,
        reviewAfter: new Date(Date.now() + 86400000).toISOString()
      }, pool);

      // Candidate 2: FEC-registered (for empty positions check)
      imported2 = await importElectionCandidate({
        identity: { system: 'fec:candidate', id: 'H6WY00456', evidence: identityEvidence },
        name: 'Bob Policyfree',
        race,
        raceEvidence,
        party: 'REP',
        eligibility: 'unknown',
        eligibilityEvidence: { system: 'fec:candidate', id: 'H6WY00456' }
      }, pool);
      candidacy2 = imported2.candidacy;

      site2 = await saveCampaignSite({
        candidacyId: candidacy2.id,
        url: 'https://bobpolicyfree.com',
        status: 'verified',
        approvedDestinations: [{ origin: 'https://bobpolicyfree.com', pathPrefix: '/' }],
        evidence: {
          url: 'https://api.open.fec.gov/v1/committee/C00987654',
          excerpt: 'Official campaign committee website',
          method: 'fec-filing',
          verifierVersion: 'verifier-v1'
        },
        checkedAt,
        reviewAfter: new Date(Date.now() + 86400000).toISOString()
      }, pool);

      assert.ok(candidacy1.id);
      assert.ok(site1.id);
      assert.ok(candidacy2.id);
      assert.ok(site2.id);
    });

    const HOME_PAGE_TEXT = 'Lowering Prescription Drug Costs\n\nEvery family deserves affordable medication.\nI will fight to cap insulin at $35 a month for all working families.';

    await t.test('syncCampaignPositions crawls, extracts, and publishes positions atomically', async () => {
      const mockPages = [
        {
          requestedUrl: 'https://janecandidate.com',
          finalUrl: 'https://janecandidate.com/',
          retrievedAt: '2026-10-26T18:00:00.000Z',
          text: HOME_PAGE_TEXT
        },
        {
          requestedUrl: 'https://janecandidate.com/issues',
          finalUrl: 'https://janecandidate.com/issues',
          retrievedAt: '2026-10-26T18:00:05.000Z',
          text: `
Protecting Wyoming Water and Lands

We must invest in conservation and protect our public lands for future generations.
          `
        }
      ];

      const mockProvider = {
        model: 'mock-gpt-5.4',
        promptVersion: 'campaign-position-prompt-1.0',
        extractPositions: async (snapshot) => {
          if (snapshot.final_url.includes('issues')) {
            return [
              {
                topic: 'environment',
                claimText: 'Supports investing in conservation and protecting public lands.',
                summary: 'Protects Wyoming public lands and conservation funding.',
                excerpt: 'We must invest in conservation and protect our public lands for future generations.'
              }
            ];
          }
          return [
            {
              topic: 'healthcare',
              claimText: 'Supports capping insulin costs at $35 per month.',
              summary: 'Caps monthly insulin costs at $35.',
              excerpt: 'I will fight to cap insulin at $35 a month for all working families.'
            }
          ];
        }
      };

      const customFetcher = async ({ initialUrl }) => {
        if (initialUrl.includes('bobpolicyfree')) {
          return {
            status: 'success',
            pages: [
              {
                requestedUrl: 'https://bobpolicyfree.com',
                finalUrl: 'https://bobpolicyfree.com/',
                retrievedAt: '2026-10-26T18:01:00.000Z',
                text: 'Welcome to the campaign. Please donate or sign up to volunteer.'
              }
            ]
          };
        }
        return {
          status: 'success',
          pages: mockPages
        };
      };

      // Run sync for Candidate 1 only
      const result = await syncCampaignPositions({
        scope: { states: ['WY'], offices: ['house'] },
        candidacyId: candidacy1.id,
        provider: mockProvider,
        customFetcher,
        db: pool
      });

      assert.equal(result.status, 'complete');
      assert.equal(result.counts.crawledSuccess, 1);
      assert.equal(result.counts.snapshotsSaved, 2);
      assert.equal(result.counts.positionsPublished, 2);

      // Verify snapshots saved
      const sources = (await pool.query('SELECT * FROM campaign_sources WHERE candidacy_id=$1', [candidacy1.id])).rows;
      assert.equal(sources.length, 2);

      // Verify published positions in database
      const positions = (await pool.query('SELECT * FROM campaign_position_versions WHERE candidacy_id=$1 AND state=\'published\'', [candidacy1.id])).rows;
      assert.equal(positions.length, 2);
      assert.ok(positions.some(p => p.topic === 'healthcare'));
      assert.ok(positions.some(p => p.topic === 'environment'));

      // Verify candidacy availability is updated to 'available'
      const candRow = (await pool.query('SELECT * FROM election_candidacies WHERE id=$1', [candidacy1.id])).rows[0];
      assert.equal(candRow.availability, 'available');
    });

    await t.test('feed query returns FEC-registered candidate with published positions', async () => {
      // Mock geography evidence
      const geo = (await pool.query(
        `INSERT INTO election_geography_evidence(state, cycle, boundary_version, source_url, checked_at, status)
         VALUES('WY', 2026, 'v1', 'https://sos.wyo.gov', now(), 'verified') RETURNING *`
      )).rows[0];

      const feed = await readElectionPositions({
        state: 'WY',
        district: 0,
        geographyEvidenceId: geo.id
      }, null, pool);

      assert.ok(feed.races.length >= 1);
      assert.equal(feed.races[0].office, 'house');
      assert.equal(feed.races[0].state, 'WY');

      // Candidate 1 published items should be in feed
      assert.equal(feed.items.length, 2);
      const item = feed.items.find(i => i.topic === 'healthcare');
      assert.ok(item);
      assert.equal(item.candidate.name, 'Jane Candidate');
      assert.equal(item.registrationStatus, 'fec-registered');
      assert.equal(item.ballotStatus, 'unknown');
      assert.equal(item.summary, 'Caps monthly insulin costs at $35.');
      assert.ok(item.excerpt.includes('cap insulin at $35 a month'));
    });

    await t.test('re-crawling identical content is idempotent and does not duplicate cards', async () => {
      const initialPositions = (await pool.query('SELECT count(*)::int n FROM campaign_position_versions')).rows[0].n;
      const initialSources = (await pool.query('SELECT count(*)::int n FROM campaign_sources')).rows[0].n;

      const identicalPage = {
        requestedUrl: 'https://janecandidate.com',
        finalUrl: 'https://janecandidate.com/',
        retrievedAt: '2026-10-26T18:30:00.000Z',
        text: HOME_PAGE_TEXT
      };

      const mockProvider = {
        model: 'mock-gpt-5.4',
        promptVersion: 'campaign-position-prompt-1.0',
        extractPositions: async () => [
          {
            topic: 'healthcare',
            claimText: 'Supports capping insulin costs at $35 per month.',
            summary: 'Caps monthly insulin costs at $35.',
            excerpt: 'I will fight to cap insulin at $35 a month for all working families.'
          }
        ]
      };

      await syncCampaignPositions({
        scope: { states: ['WY'], offices: ['house'] },
        candidacyId: candidacy1.id,
        provider: mockProvider,
        customFetcher: async () => ({ status: 'success', pages: [identicalPage] }),
        db: pool
      });

      const afterPositions = (await pool.query('SELECT count(*)::int n FROM campaign_position_versions')).rows[0].n;
      const afterSources = (await pool.query('SELECT count(*)::int n FROM campaign_sources')).rows[0].n;

      assert.equal(afterSources, initialSources);
      assert.equal(afterPositions, initialPositions);
    });

    await t.test('changing policy text supersedes old version while preserving user interaction', async () => {
      // 1. User records approval on current version
      const currentVersions = (await pool.query('SELECT * FROM campaign_position_versions WHERE candidacy_id=$1 AND topic=\'healthcare\' AND state=\'published\'', [candidacy1.id])).rows;
      assert.equal(currentVersions.length, 1);
      const v1 = currentVersions[0];

      // Add a test user
      const user = (await pool.query('INSERT INTO users(clerk_user_id) VALUES(\'user_123\') RETURNING *')).rows[0];
      await saveElectionResponse({ clerkUserId: 'user_123' }, {
        positionVersionId: v1.id,
        stance: 'approve',
        privateComment: 'Very important for seniors'
      }, pool);

      // Verify user interaction recorded
      const interaction1 = (await pool.query('SELECT * FROM election_interactions WHERE user_id=$1', [user.id])).rows[0];
      assert.equal(interaction1.stance, 'approve');
      assert.equal(interaction1.position_version_id, v1.id);

      // 2. Candidate updates their stance to $25 cap
      const updatedPage = {
        requestedUrl: 'https://janecandidate.com',
        finalUrl: 'https://janecandidate.com/',
        retrievedAt: '2026-10-26T19:00:00.000Z',
        text: `
Lowering Prescription Drug Costs

Every family deserves affordable medication.
I will fight to cap insulin at $25 a month for all working families.
        `
      };

      const mockProvider = {
        model: 'mock-gpt-5.4',
        promptVersion: 'campaign-position-prompt-1.0',
        extractPositions: async () => [
          {
            claimId: v1.claim_id, // Same claim identity, updated text
            topic: 'healthcare',
            claimText: 'Supports capping insulin costs at $25 per month.',
            summary: 'Caps monthly insulin costs at $25.',
            excerpt: 'I will fight to cap insulin at $25 a month for all working families.'
          }
        ]
      };

      await syncCampaignPositions({
        scope: { states: ['WY'], offices: ['house'] },
        candidacyId: candidacy1.id,
        provider: mockProvider,
        customFetcher: async () => ({ status: 'success', pages: [updatedPage] }),
        db: pool
      });

      // Verify v1 is now superseded
      const v1Reload = (await pool.query('SELECT * FROM campaign_position_versions WHERE id=$1', [v1.id])).rows[0];
      assert.equal(v1Reload.state, 'superseded');

      // Verify new published version exists
      const v2 = (await pool.query('SELECT * FROM campaign_position_versions WHERE candidacy_id=$1 AND topic=\'healthcare\' AND state=\'published\'', [candidacy1.id])).rows[0];
      assert.notEqual(v2.id, v1.id);
      assert.equal(v2.summary, 'Caps monthly insulin costs at $25.');

      // Verify user's interaction is STILL attached to v1 (historical integrity!)
      const interactionReload = (await pool.query('SELECT * FROM election_interactions WHERE user_id=$1', [user.id])).rows[0];
      assert.equal(interactionReload.position_version_id, v1.id);
      assert.equal(interactionReload.private_comment, 'Very important for seniors');
    });

    await t.test('site with no policy text results in availability = no-positions', async () => {
      const mockProvider = {
        model: 'mock-gpt-5.4',
        promptVersion: 'campaign-position-prompt-1.0',
        extractPositions: async () => [] // no positions
      };

      await syncCampaignPositions({
        scope: { states: ['WY'], offices: ['house'] },
        candidacyId: candidacy2.id,
        provider: mockProvider,
        customFetcher: async () => ({
          status: 'success',
          pages: [
            {
              requestedUrl: 'https://bobpolicyfree.com',
              finalUrl: 'https://bobpolicyfree.com/',
              retrievedAt: '2026-10-26T18:00:00.000Z',
              text: 'Welcome to the campaign. Please donate today.'
            }
          ]
        }),
        db: pool
      });

      const cand2Row = (await pool.query('SELECT * FROM election_candidacies WHERE id=$1', [candidacy2.id])).rows[0];
      assert.equal(cand2Row.availability, 'no-positions');
    });

    await t.test('crawl failure records failure and sets availability = crawl-failed', async () => {
      // Create candidate 3 with verified site pointing to unapproved redirect/failure
      const imported3 = await importElectionCandidate({
        identity: { system: 'fec:candidate', id: 'H6WY00789', evidence: { url: 'https://api.open.fec.gov/v1/candidates', checkedAt: new Date().toISOString() } },
        name: 'Charlie Unreachable',
        race,
        raceEvidence: { url: 'https://api.open.fec.gov/v1/candidates', checkedAt: new Date().toISOString(), basis: 'fec-registration', ballotConfirmed: false },
        party: 'IND',
        eligibility: 'unknown',
        eligibilityEvidence: { system: 'fec:candidate', id: 'H6WY00789' }
      }, pool);

      await saveCampaignSite({
        candidacyId: imported3.candidacy.id,
        url: 'https://charlie.com',
        status: 'verified',
        approvedDestinations: [{ origin: 'https://charlie.com', pathPrefix: '/' }],
        evidence: {
          url: 'https://api.open.fec.gov/v1/committee/C00999999',
          excerpt: 'Official campaign committee website',
          method: 'fec-filing',
          verifierVersion: 'verifier-v1'
        },
        checkedAt: new Date().toISOString(),
        reviewAfter: new Date(Date.now() + 86400000).toISOString()
      }, pool);

      await syncCampaignPositions({
        scope: { states: ['WY'], offices: ['house'] },
        candidacyId: imported3.candidacy.id,
        customFetcher: async () => {
          throw new Error('Connection timeout');
        },
        db: pool
      });

      const cand3Row = (await pool.query('SELECT * FROM election_candidacies WHERE id=$1', [imported3.candidacy.id])).rows[0];
      assert.equal(cand3Row.availability, 'crawl-failed');
      assert.equal(cand3Row.failure_code, 'crawl-failed');
    });
  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${database}`);
    await admin.end();
  }
});
