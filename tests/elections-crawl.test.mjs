import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanCampaignHtml } from '../server/src/elections/cleanCampaignHtml.js';
import { isApprovedDestination, crawlCampaignSite } from '../server/src/elections/crawlCampaign.js';
import {
  deterministicClaimId,
  validateCampaignPositions,
  createCampaignExtractionProvider,
  VALIDATOR_VERSION
} from '../server/src/elections/extractPositions.js';

test('cleanCampaignHtml removes boilerplate, nav, footers, forms, and preserves headings and paragraphs', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Jane Doe for Congress</title>
        <style>.header { color: red; }</style>
        <script>console.log("tracker");</script>
      </head>
      <body>
        <header>
          <nav>
            <a href="/">Home</a>
            <a href="/about">About</a>
            <a href="/donate" class="donate-btn">Donate Now</a>
          </nav>
        </header>
        <main>
          <h1>Lowering Healthcare Costs</h1>
          <p>Every American deserves affordable healthcare.</p>
          <div class="fundraising-banner">
            <p>Chip in $5 before midnight to help us reach our goal!</p>
            <a href="https://secure.actblue.com/donate/janedoe">Donate on ActBlue</a>
          </div>
          <h2>Our Policy Priorities</h2>
          <ul>
            <li>Cap prescription drug prices at $35 monthly.</li>
            <li>Expand Medicare coverage to include dental and vision care.</li>
          </ul>
          <form action="/signup">
            <input type="email" placeholder="Join our email list" />
            <button type="submit">Subscribe</button>
          </form>
        </main>
        <footer>
          <p>Paid for by Jane Doe for Congress</p>
        </footer>
      </body>
    </html>
  `;

  const cleaned = cleanCampaignHtml(html);

  // Assert boilerplate and script/style elements are stripped
  assert.ok(!cleaned.includes('console.log'));
  assert.ok(!cleaned.includes('.header {'));
  assert.ok(!cleaned.includes('Donate Now'));
  assert.ok(!cleaned.includes('Chip in $5'));
  assert.ok(!cleaned.includes('ActBlue'));
  assert.ok(!cleaned.includes('Paid for by Jane Doe'));
  assert.ok(!cleaned.includes('Subscribe'));

  // Assert headings and paragraphs are preserved
  assert.ok(cleaned.includes('Lowering Healthcare Costs'));
  assert.ok(cleaned.includes('Every American deserves affordable healthcare.'));
  assert.ok(cleaned.includes('Our Policy Priorities'));
  assert.ok(cleaned.includes('Cap prescription drug prices at $35 monthly.'));
  assert.ok(cleaned.includes('Expand Medicare coverage to include dental and vision care.'));
});

test('isApprovedDestination validates origin, path prefix, protocol, and excludes unapproved/disallowed domains', () => {
  const destinations = [
    { origin: 'https://janedoe.com', pathPrefix: '/' },
    { origin: 'https://votesmith.org', pathPrefix: '/2026' }
  ];

  // Approved
  assert.equal(isApprovedDestination('https://janedoe.com', destinations), true);
  assert.equal(isApprovedDestination('https://janedoe.com/issues', destinations), true);
  assert.equal(isApprovedDestination('https://janedoe.com/issues/healthcare', destinations), true);
  assert.equal(isApprovedDestination('https://votesmith.org/2026', destinations), true);
  assert.equal(isApprovedDestination('https://votesmith.org/2026/platform', destinations), true);

  // Unapproved origins or paths
  assert.equal(isApprovedDestination('https://votesmith.org/', destinations), false);
  assert.equal(isApprovedDestination('https://votesmith.org/2024', destinations), false);
  assert.equal(isApprovedDestination('https://evil.com', destinations), false);
  assert.equal(isApprovedDestination('http://janedoe.com', destinations), false); // scheme mismatch

  // Credentials and invalid protocols
  assert.equal(isApprovedDestination('https://user:pass@janedoe.com/issues', destinations), false);
  assert.equal(isApprovedDestination('javascript:alert(1)', destinations), false);
  assert.equal(isApprovedDestination('ftp://janedoe.com', destinations), false);

  // Disallowed donation processors and social domains
  assert.equal(isApprovedDestination('https://secure.actblue.com/donate', [{ origin: 'https://secure.actblue.com', pathPrefix: '/' }]), false);
  assert.equal(isApprovedDestination('https://winred.com/donate', [{ origin: 'https://winred.com', pathPrefix: '/' }]), false);
  assert.equal(isApprovedDestination('https://twitter.com/candidate', [{ origin: 'https://twitter.com', pathPrefix: '/' }]), false);
  assert.equal(isApprovedDestination('https://facebook.com/candidate', [{ origin: 'https://facebook.com', pathPrefix: '/' }]), false);
});

test('deterministicClaimId produces repeatable standard UUID format', () => {
  const candidacyId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  const claimText = 'Supports expanding solar energy tax credits';

  const id1 = deterministicClaimId(candidacyId, claimText);
  const id2 = deterministicClaimId(candidacyId, claimText);
  const id3 = deterministicClaimId(candidacyId, 'Different claim text');

  assert.equal(id1, id2);
  assert.notEqual(id1, id3);

  // Standard UUID format 8-4-4-4-12
  assert.match(id1, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('validateCampaignPositions accepts valid items, rejects missing excerpts or invalid topics, and deduplicates', () => {
  const snapshot = {
    id: '11111111-1111-1111-1111-111111111111',
    candidacyId: '22222222-2222-2222-2222-222222222222',
    text: `
Lowering Prescription Drug Costs

Every working family deserves affordable medication.
I will fight to cap insulin at $35 a month for all working families.

Investing in Clean Energy

We must transition to renewable energy sources to protect our water and air.
    `
  };

  const rawItems = [
    {
      topic: 'healthcare',
      claimText: 'Supports capping insulin prices at $35 per month.',
      summary: 'Caps monthly insulin costs at $35.',
      excerpt: 'I will fight to cap insulin at $35 a month for all working families.'
    },
    {
      // Duplicate of first item
      topic: 'healthcare',
      claimText: 'Supports capping insulin prices at $35 per month.',
      summary: 'Duplicate summary.',
      excerpt: 'I will fight to cap insulin at $35 a month for all working families.'
    },
    {
      // Valid second item
      topic: 'environment',
      claimText: 'Supports transitioning to renewable energy to protect water and air.',
      summary: 'Promotes transition to renewable clean energy.',
      excerpt: 'We must transition to renewable energy sources to protect our water and air.'
    },
    {
      // Invalid: excerpt missing in snapshot
      topic: 'education',
      claimText: 'Supports free universal pre-K education.',
      summary: 'Universal pre-K funding.',
      excerpt: 'I believe every four-year-old child should have access to free preschool.'
    },
    {
      // Invalid: topic not in allowed list
      topic: 'astrology',
      claimText: 'Aligns government with zodiac signs.',
      summary: 'Zodiac alignment policy.',
      excerpt: 'Every working family deserves affordable medication.'
    }
  ];

  const result = validateCampaignPositions(rawItems, snapshot);

  assert.equal(result.outcome, 'valid');
  assert.equal(result.items.length, 2); // 2 valid items (1 duplicate dropped, 2 invalid dropped)

  const [first, second] = result.items;
  assert.equal(first.topic, 'healthcare');
  assert.equal(first.validation.outcome, 'valid');
  assert.equal(first.validation.validatorVersion, VALIDATOR_VERSION);
  assert.equal(second.topic, 'environment');

  // Verify errors collected for the invalid ones
  assert.equal(result.errors.length, 2);
  assert.ok(result.errors.some(e => e.errors?.includes('excerpt-missing')));
  assert.ok(result.errors.some(e => e.errors?.includes('topic')));
});

test('validateCampaignPositions treats empty array as valid no-positions outcome', () => {
  const snapshot = {
    id: '11111111-1111-1111-1111-111111111111',
    candidacyId: '22222222-2222-2222-2222-222222222222',
    text: 'Welcome to our campaign. Please volunteer or chip in today.'
  };

  const result = validateCampaignPositions([], snapshot);
  assert.equal(result.outcome, 'valid');
  assert.equal(result.items.length, 0);
});

test('crawlCampaignSite enforces verified site state and approved destinations with custom fetcher', async () => {
  const validSite = {
    id: 'site-1',
    candidacy_id: 'cand-1',
    proposed_url: 'https://candidate.com',
    status: 'verified',
    approved_destinations: [{ origin: 'https://candidate.com', pathPrefix: '/' }],
    review_after: new Date(Date.now() + 86400000).toISOString()
  };

  // Rejects unverified site
  await assert.rejects(
    () => crawlCampaignSite({ site: { ...validSite, status: 'proposed' } }),
    /crawl-site-unverified/
  );

  // Rejects expired site
  await assert.rejects(
    () => crawlCampaignSite({ site: { ...validSite, review_after: new Date(Date.now() - 1000).toISOString() } }),
    /crawl-site-expired/
  );

  // Rejects unapproved start URL
  await assert.rejects(
    () => crawlCampaignSite({ site: validSite, startUrl: 'https://unapproved.com' }),
    /crawl-unapproved-destination/
  );

  // Successful crawl with custom fetcher
  const crawlResult = await crawlCampaignSite({
    site: validSite,
    customFetcher: async () => ({
      status: 'success',
      pages: [
        {
          requestedUrl: 'https://candidate.com',
          finalUrl: 'https://candidate.com/home',
          text: 'Cleaned home text with policy positions.',
          retrievedAt: new Date().toISOString()
        }
      ]
    })
  });

  assert.equal(crawlResult.status, 'success');
  assert.equal(crawlResult.pages.length, 1);
  assert.equal(crawlResult.pages[0].finalUrl, 'https://candidate.com/home');
});

test('createCampaignExtractionProvider returns positions and handles retry on failure', async () => {
  let callCount = 0;
  const mockClient = {
    responses: {
      create: async () => {
        callCount++;
        if (callCount === 1) {
          throw Object.assign(new Error('Rate limit exceeded'), { status: 429 });
        }
        return {
          status: 'completed',
          output_text: JSON.stringify({
            positions: [
              {
                topic: 'housing',
                claimText: 'Supports building 10,000 affordable housing units.',
                summary: 'Plans to construct 10,000 affordable homes.',
                excerpt: 'We will build 10,000 affordable housing units across the state.'
              }
            ]
          })
        };
      }
    }
  };

  const provider = createCampaignExtractionProvider({ client: mockClient, maxAttempts: 2 });
  const snapshot = {
    id: 'snap-1',
    candidacyId: 'cand-1',
    text: 'We will build 10,000 affordable housing units across the state.'
  };

  // In this test, first call fails with 429 which throws discovery-ai-rate-limited directly
  await assert.rejects(
    () => provider.extractPositions(snapshot),
    /discovery-ai-rate-limited/
  );

  // Second test: recoverable error on attempt 1, success on attempt 2
  let recoverCount = 0;
  const recoverableClient = {
    responses: {
      create: async () => {
        recoverCount++;
        if (recoverCount === 1) {
          throw new Error('Temporary network glitch');
        }
        return {
          status: 'completed',
          output_text: JSON.stringify({
            positions: [
              {
                topic: 'housing',
                claimText: 'Supports building 10,000 affordable housing units.',
                summary: 'Plans to construct 10,000 affordable homes.',
                excerpt: 'We will build 10,000 affordable housing units across the state.'
              }
            ]
          })
        };
      }
    }
  };

  const recoverableProvider = createCampaignExtractionProvider({ client: recoverableClient, maxAttempts: 2 });
  const positions = await recoverableProvider.extractPositions(snapshot);
  assert.equal(positions.length, 1);
  assert.equal(positions[0].topic, 'housing');
});
