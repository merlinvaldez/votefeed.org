# Election storage (Step 2)

Implemented locally on 2026-10-26. No remote migrations, production deployment, API routes, UI, or schedules are claimed.

## Migration and access

`supabase/migrations/20261026194547_elections_storage.sql` is additive and requires existing `public.users(id, clerk_user_id)` and `public.reps(bioguideid)`. It uses PostgreSQL 15+ null-aware uniqueness. Apply it through the normal migration upgrade workflow; `db:reset` is not an upgrade path.

All 14 new tables enable RLS and revoke every table privilege from PUBLIC, anon and authenticated. There are deliberately no browser policies. The server pool uses the existing DATABASE_URL connection; its trusted owner/BYPASSRLS role can access these tables. service_role receives DML grants, but grants alone do not bypass RLS. The disposable tests exercise postgres, service_role, anon and authenticated; the deployed DATABASE_URL role and deployed default privileges still require rollout verification. A privileged direct SQL connection can bypass ownership checks, so routes must call the owned query functions, never expose arbitrary SQL or the pool to clients. This follows the [Supabase distinction between grants and RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

Sources and site verification revisions are immutable. Position wording, summary and original evidence are immutable; only publication state changes. Source URLs must match approved origin/path destinations when captured. DNS/private-network/redirect enforcement remains the crawler's responsibility; this persistence module does not fetch URLs.

## Shared functions

Import from `server/src/db/queries/elections.js`. Functions default to the existing pg Pool. Transactional functions accept an optional Pool as their final argument; simple functions accept a query runner. Never pass a shared checked-out client to a transactional function.

- `importElectionCandidate({identity:{system,id,evidence}, name, race, raceEvidence, party, eligibility, eligibilityEvidence, candidateId?, matchStatus?, matchEvidence?, memberId?})` upserts exact person identifiers. A new source ID creates a separate person unless candidateId and official crossReference evidence explicitly link it. Committee IDs cannot establish person identity. Names never merge people. Ambiguous candidates persist.
- `reconcileElectionRace({race,records})` imports one exact race's records atomically. Every record has the import shape above. Missing records never imply withdrawal. Supply explicit dated state evidence for withdrawal/disqualification. Older state observations and unknown observations cannot replace newer ballot facts; discovery-only FEC facts cannot overwrite state eligibility. Adapters remain responsible for resolving conflicting authoritative artifacts before submitting observations.
- `saveCampaignSite({candidacyId,url,status,approvedDestinations:[{origin,pathPrefix}],evidence,checkedAt,reviewAfter,invalidationReason?})` creates a new site revision and revokes the previous current revision. Verified evidence requires URL, excerpt, method and verifierVersion, plus a review deadline. An AI-discovered `ambiguous` site can crawl and publish when it has a valid URL, approved destinations and an active review deadline; rejected, missing, proposed, moved, or expired sites cannot publish. Previously published cards require supporting evidence from the current eligible site revision before reappearing.
- `saveCampaignSnapshot({candidacyId,siteId,requestedUrl,finalUrl,retrievedAt,text})` saves exact UTF-8 SHA-256 content and copied verification evidence before AI. Same content/URL/site revision returns the original snapshot and retrieval date. Each fetch records a separate attempt.
- `publishCampaignPositions({candidacyId,snapshotId,runId?,model,promptVersion,completeness,items})` accepts the Step 1 extraction items plus server-assigned claimId and validation `{outcome:'valid',validatorVersion,reasons:[]}`. Completeness must be complete or partial. A worker must perform semantic validation before calling this function; structural validation and SQL excerpt checks do not prove semantic faithfulness.
- `recordCampaignFailure({candidacyId,snapshotId?,runId?,status,model?,promptVersion?,validation?})` records crawl-failed or extraction-failed without replacing last-successful records. Validation can preserve rejected-item outcomes. Pass machine codes and safe validation evidence, never credentials or raw provider error objects.
- `startElectionRun({stage,scope?,adapter,adapterVersion,lastSuccessfulRunId?})` and `finishElectionRun(id,{status,counts,coverage,errorCodes})` track bounded machine errors and coverage. Complete outcomes require a complete entry for every requested state/office. Coverage entries may include race IDs, page counts, unresolved counts, source references and explicit noRaces. Workers must provide honest source evidence; this storage layer cannot establish nationwide coverage itself.
- `saveElectionGeography({state,cycle,boundaryVersion,sourceUrl,checkedAt,status})` persists verified/unresolved election-specific boundaries. Fixture evidence is never a production geography audit.

Publication locks the candidacy and commits versions, evidence, explicit per-source removal and availability together. No network or AI call belongs inside this transaction. Complete empty results remove that URL's current claims; partial or failed results cannot remove them. Claims from other URLs are untouched. Reusing accepted claim text and lineage returns the original version; changed text creates a new version. Reprocessing attaches model/prompt/validation and presentation evidence without overwriting the answered wording. The worker must reconcile lineage explicitly; uncertain matches use review or a new claimId.

## Reads and authenticated responses

`readElectionPositions({state,district?,geographyEvidenceId?,scope?,limit?,cursor?}, auth?)` returns scope, coverage, races, items, nextCursor and distinct empty/geography availability. Defaults use RELEASE_SCOPE, limit 20 (maximum 50). Scope can only narrow the release. House matching requires verified evidence for the requested state and cycle; Senate matching remains independent. No-race is returned only with explicit complete per-office noRaces evidence; incomplete coverage is coverage-unknown.

Items contain candidate, race, candidacyId, claimId, positionVersionId, topic, summary, excerpt, source `{snapshotId,url,retrievedAt}`, availability and the requesting user's own response or null. Eligibility, a current unexpired `verified` or `ambiguous` site, claim validation and publication state are mandatory filters. Failed refreshes preserve original source dates. Errors propagate. Reads use a repeatable-read snapshot and the shared contract's stable ascending race/candidate/claim/version order. Cursor bindings include the scope, location, viewer and visible publication set; changes require restarting. This initial bounded persistence implementation loads the matching records before pagination; later API work should measure volume before introducing indexed keyset pagination.

Future routes obtain Clerk identity from `req.auth().userId` and the mapped user from the existing getUserFromToken middleware. Build auth on the server as `{clerkUserId:req.auth().userId,userId:req.user.id}`; never spread client input into auth. The queries resolve users.clerk_user_id and reject a mismatching userId. Guests pass null for reads and cannot write.

- `saveElectionResponse(auth,{positionVersionId,stance,privateComment?})` upserts one owned response. Stance is approve/disapprove/null. Omitted privateComment preserves it; explicit null clears it. Client userId/user_id fields are rejected.
- `getElectionResponse(auth,positionVersionId)` reads only that user's response, including historical versions.
- `deleteElectionResponse(auth,positionVersionId)` deletes only that user's response/comment.

No election response enters legislative interactions, public comments, alignment or notifications. Later routes must enforce their normal authentication and request validation; no public route is created here.

## Verification

From the repository root in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/run-postgres-tests.ps1 -TestFile elections-postgres.test.mjs
npm.cmd run test:postgres
npm.cmd run test:all
```

The focused test creates and drops a uniquely named database on the fixed local test cluster at 127.0.0.1:55439. It applies the exact migration with prerequisite tables, tests concurrent retries, atomic race import/publication rollback, source fingerprints/revisions, response ownership, stance clearing, history, removal, failed refresh, eligibility/geography filtering, cursor invalidation, and browser-role grants/RLS. Existing PostgreSQL suites exercise legislative query regression separately.

Verified: focused suite passes (8 tests); shared contracts, Deno notification tests (18), client lint and production build pass. The full Node suite reports four failures in existing live Senate XML tests: senate.gov responds HTTP 403, so menu/status and parsed vote identity assertions fail. No Senate parser changes were made. Full-suite green status and deployed role/migration acceptance remain open.
