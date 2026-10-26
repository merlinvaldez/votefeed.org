# Campaign Crawl, Extraction, and Feed Contract Handoff (Steps 4 & 5)

Implemented locally on October 26, 2026. This completes the foundation trilogy (DB, DISC, CRAWL) for the 2026 Elections Feed. No remote migrations or production schedules were applied.

## 1. Overview and Architecture

The CRAWL ticket (`server/src/elections/syncCampaignPositions.js`) bridges verified public campaign websites to source-backed, semantic policy positions displayed in the voter feed.

```
+-----------------------------------------------------------------------------------------+
| Candidate Discovery & Verification (DISC)                                              |
| - Verified Candidacy with Approved Destination Origins/PathPrefixes                     |
+-----------------------------------------------------------------------------------------+
                                           │
                                           ▼
+-----------------------------------------------------------------------------------------+
| Crawl Campaign Sites (crawlCampaign.js)                                                |
| - Crawlee CheerioCrawler with strict DNS resolution & private IP blocking               |
| - Excludes donation processors (actblue, winred) & social networks                     |
| - Filters non-HTML extensions (.pdf, .jpg, etc.) & bounds max pages/concurrency         |
+-----------------------------------------------------------------------------------------+
                                           │
                                           ▼
+-----------------------------------------------------------------------------------------+
| Text Cleaning & Snapshot Preservation (cleanCampaignHtml.js & elections.js)            |
| - Cheerio cleaner strips nav, headers, footers, forms, scripts, donation CTAs          |
| - Preserves headings and paragraph structure for coherent policy context               |
| - Immutable snapshot saved to campaign_sources with SHA-256 fingerprint before AI      |
+-----------------------------------------------------------------------------------------+
                                           │
                                           ▼
+-----------------------------------------------------------------------------------------+
| AI Extraction & Structural Validation (extractPositions.js & campaignPositionExtraction.md)|
| - Dedicated prompt treating campaign HTML as untrusted data                            |
| - Strict JSON schema output: topic in approved TOPICS, concise summary, verbatim excerpt|
| - validateCampaignPositions checks exact substring match in snapshot                   |
| - Bounded retries on provider failure or schema violations                             |
+-----------------------------------------------------------------------------------------+
                                           │
                                           ▼
+-----------------------------------------------------------------------------------------+
| Atomic Publication & Versioning (elections.js: publishCampaignPositions)               |
| - Deterministic UUID claim IDs via candidacyId + claimText                             |
| - Re-crawl of identical text is idempotent (no duplicate cards)                        |
| - Changed policy text supersedes prior version and preserves historical user answers   |
| - Empty policy content publishes availability = 'no-positions'                         |
+-----------------------------------------------------------------------------------------+
                                           │
                                           ▼
+-----------------------------------------------------------------------------------------+
| Feed Read Contract (elections.js: readElectionPositions)                               |
| - Filters by verified geography, fec-registered or ballot-confirmed eligibility        |
| - Requesting user's own private stance and comment (guests receive null)               |
| - Strict ascending deterministic sort order                                            |
+-----------------------------------------------------------------------------------------+
```

---

## 2. Modules & Responsibilities

| File | Purpose |
| --- | --- |
| `server/src/elections/cleanCampaignHtml.js` | Cleans raw HTML using Cheerio, stripping non-content elements and boilerplate while preserving headings and paragraph boundaries. |
| `server/src/elections/crawlCampaign.js` | Crawlee-based web crawler enforcing strict SSRF protections, destination domain whitelisting, public DNS resolution, and crawl limits. |
| `server/src/elections/extractPositions.js` | Deterministic claim ID generation (`deterministicClaimId`), structural and excerpt validation (`validateCampaignPositions`), and OpenAI extraction provider. |
| `server/src/ai/prompts/campaignPositionExtraction.md` | System prompt enforcing strict grounding, approved topics, concise plain summaries, and defenses against prompt injection in campaign copy. |
| `server/src/elections/syncCampaignPositions.js` | Server-only coordinator worker running outside feed requests to crawl, snapshot, extract, validate, and atomically publish candidate positions. |
| `server/src/elections/cli.js` | Server CLI supporting `--crawl-campaigns --write [--states WY] [--candidate-id UUID]`. |
| `tests/elections-crawl.test.mjs` | 7 unit tests covering HTML cleaning, destination approval, deterministic UUIDs, schema validation, empty no-positions, and extraction retry. |
| `tests/elections-crawl-postgres.test.mjs` | 8 PostgreSQL integration tests on disposable cluster covering end-to-end sync, feed reading, idempotency, version superseding, no-positions, and crawl failure. |

---

## 3. Feed Read & Response Contract (Step 5 Handoff)

### 3.1 Input Parameters for `readElectionPositions`

```typescript
interface ReadElectionPositionsParams {
  state: string;                    // 2-letter uppercase postal code (e.g. 'WY')
  district?: number;               // Numeric House district (0 for at-large, e.g. WY-0)
  geographyEvidenceId?: string;    // UUID of verified election geography record
  scope?: ReleaseScope;            // Defaults to RELEASE_SCOPE (2026, House/Senate, regular)
  limit?: number;                  // Page size (default: 20, max: 50)
  cursor?: string;                 // Opaque pagination cursor
}

interface AuthContext {
  userId: string;                  // Internal UUID in public.users
  clerkUserId: string;             // Clerk user ID from auth token
}
```

### 3.2 Output Contract

```typescript
interface ElectionFeedResponse {
  scope: ReleaseScope;
  coverage: 'complete' | 'partial' | 'coverage-unknown';
  races: Array<{
    id: string;
    office: 'house' | 'senate';
    state: string;
    district: number | null;
    seat: number | null;
    electionDate: string;          // ISO date (e.g. '2026-11-03')
    availability: string;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    safeFailureCode: string | null;
  }>;
  items: Array<{
    candidacyId: string;
    candidate: {
      id: string;
      name: string;
      party: string;
    };
    race: {
      id: string;
      office: 'house' | 'senate';
      state: string;
      district: number | null;
      seat: number | null;
      electionDate: string;
      stage: 'general';
      contestType: 'regular';
    };
    claimId: string;
    positionVersionId: string;
    topic: string;                 // One of the 10 approved TOPICS
    summary: string;               // 1-500 char plain language statement
    excerpt: string;               // Exact verbatim quote from campaign website
    source: {
      snapshotId: string;
      url: string;
      retrievedAt: string;
    };
    availability: 'published' | 'no-positions' | 'crawl-failed' | 'extraction-failed';
    registrationStatus: 'fec-registered' | 'ballot-confirmed';
    ballotStatus: 'unknown' | 'confirmed';
    response: {
      stance: 'approve' | 'disapprove' | null;
      privateComment: string | null;
    } | null;                      // null for guest reads or unanswered cards
  }>;
  nextCursor: string | null;
}
```

### 3.3 Express Route Authentication Pattern

Later API routes must use the existing auth stack:
```javascript
import { getUserFromToken } from '../middleware/getUserFromToken.js';
import { readElectionPositions, saveElectionResponse, deleteElectionResponse } from '../db/queries/elections.js';

// GET /api/elections/feed
app.get('/api/elections/feed', getUserFromToken, async (req, res) => {
  const auth = req.user ? { userId: req.user.id, clerkUserId: req.user.clerk_user_id } : null;
  const result = await readElectionPositions({
    state: req.query.state,
    district: req.query.district ? Number(req.query.district) : undefined,
    geographyEvidenceId: req.query.geographyEvidenceId,
    limit: req.query.limit ? Number(req.query.limit) : 20,
    cursor: req.query.cursor
  }, auth);
  res.json(result);
});

// POST /api/elections/responses
app.post('/api/elections/responses', getUserFromToken, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  const auth = { userId: req.user.id, clerkUserId: req.user.clerk_user_id };
  const { positionVersionId, stance, privateComment } = req.body;
  const saved = await saveElectionResponse(auth, { positionVersionId, stance, privateComment });
  res.json(saved);
});
```

---

## 4. Frontend & API Work Needed in Later Tickets

The foundation tickets (DB, DISC, CRAWL) provide the complete data layer and ingestion pipelines. The following items belong to subsequent UI/API tickets:

1. **HTTP Endpoints (`server/src/api/elections.js`)**:
   - `GET /api/elections/feed`: Validates query params against `RELEASE_SCOPE` and calls `readElectionPositions`.
   - `POST /api/elections/responses`: Upserts user stance and private note via `saveElectionResponse`.
   - `DELETE /api/elections/responses/:versionId`: Clears user response via `deleteElectionResponse`.
2. **Client Elections Tab (`client/src/`)**:
   - Location header integrating user's district from `/api/districts` with fallback state/district selector.
   - Filter chips for Chamber (House vs Senate) and Topics (Economy, Healthcare, etc.).
   - Candidate Cards:
     - Clear candidate identity with party portrait color.
     - `fec-registered` badge with disclaimer ("FEC registrant; ballot access pending certified state list").
     - Concise policy claim summary and expandable exact quote with source link.
     - Stance toggle (Approve / Disapprove) and private note modal.
   - Empty/Loading States:
     - Distinguishing between `no-positions` (campaign has no public issues page), `crawl-failed`, and unverified sites.
   - Keyset infinite scroll using `nextCursor`.
3. **End-to-End Browser Verification**:
   - Playwright/agent-browser tests verifying authenticated vs guest user views, response toggling, and district switching.

---

## 5. Verification Evidence

- `tests/elections-contracts.test.mjs`: 5/5 passed.
- `tests/elections-crawl.test.mjs`: 7/7 passed.
- `tests/elections-crawl-postgres.test.mjs`: 8/8 passed.
- All elections PostgreSQL test files (`tests/run-postgres-tests.ps1 elections-*.test.mjs`): **56/56 passed**.
