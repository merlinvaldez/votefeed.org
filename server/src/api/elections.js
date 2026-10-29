import express from "express";
import { getDistrictFromAddress } from "../db/queries/districts.js";
import {
  clearElectionResponse,
  ensureElectionFeedBuildJobs,
  readElectionGeographyForUser,
  readElectionPositions,
  readElectionRoster,
  saveElectionResponse,
} from "../db/queries/elections.js";
import { resolveElectionGeography } from "../elections/electionGeography.js";
import { dispatchElectionFeedBuilds } from "../elections/dispatchElectionFeedBuilds.js";
import {
  ELECTION_GEOGRAPHY_SOURCE,
  ELECTION_GEOGRAPHY_VERSION,
  RELEASE_SCOPE,
  TOPICS,
  normalizeState,
} from "../elections/contracts.js";

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = message => Object.assign(new TypeError(message), { status: 400, code: "INVALID_ELECTION_REQUEST" });

function authFor(req) {
  let clerkUserId = null;
  try { clerkUserId = req.auth?.().userId ?? null; } catch { /* public request */ }
  return clerkUserId ? { clerkUserId, userId: req.user?.id } : null;
}

function requireElectionUser(req, res, next) {
  if (!authFor(req) || !req.user) {
    return res.status(401).json({ code: "AUTHENTICATION_REQUIRED", error: "Sign in to respond to campaign positions." });
  }
  return next();
}

function requestBody(req) {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) throw invalid("A JSON request body is required.");
  return req.body;
}

function parseReadOptions(body) {
  if (body.state !== undefined || body.district !== undefined || body.geography !== undefined || body.geographyEvidenceId !== undefined) {
    throw invalid("Election geography is resolved by the server.");
  }
  const chamber = body.chamber ?? "all";
  if (!["all", "house", "senate"].includes(chamber)) throw invalid("Invalid chamber.");
  const candidacyId = body.candidacyId ?? null;
  if (candidacyId !== null && (typeof candidacyId !== "string" || !UUID.test(candidacyId))) throw invalid("Invalid candidacy ID.");
  const policyArea = body.policyArea ?? null;
  if (policyArea !== null && (typeof policyArea !== "string" || !TOPICS.includes(policyArea))) throw invalid("Invalid policy area.");
  const limit = body.limit === undefined ? 20 : body.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw invalid("Limit must be an integer from 1 to 50.");
  const cursor = body.cursor ?? null;
  if (cursor !== null && (typeof cursor !== "string" || cursor.length > 4096 || !/^[\w-]+$/.test(cursor))) {
    throw invalid("Invalid Elections cursor.");
  }
  return { chamber, candidacyId, policyArea, limit, cursor };
}

function publicGeography(input) {
  return {
    status: input.status,
    state: input.state,
    houseDistrict: input.status === "verified" ? input.district : null,
  };
}

async function resolveRequestGeography(req, body, auth) {
  if (auth) {
    const saved = await readElectionGeographyForUser(auth);
    const currentState = req.user?.state ? normalizeState(req.user.state) : null;
    if (saved?.state && saved.state === currentState && saved.cycle === RELEASE_SCOPE.cycle &&
        saved.boundaryVersion === ELECTION_GEOGRAPHY_VERSION && saved.sourceUrl === ELECTION_GEOGRAPHY_SOURCE) {
      const verified = saved.status === "verified" && Number.isInteger(saved.district);
      return {
        state: saved.state,
        district: verified ? saved.district : null,
        status: verified ? "verified" : "state-only",
        evidenceId: verified ? saved.evidenceId : null,
        geography: {
          state: saved.state,
          district: verified ? saved.district : null,
          status: verified ? "verified" : "unresolved",
          cycle: saved.cycle,
          boundaryVersion: saved.boundaryVersion,
          sourceUrl: saved.sourceUrl,
        },
      };
    }
    return {
      state: currentState,
      district: null,
      status: currentState ? "state-only" : "unavailable",
      evidenceId: null,
      geography: null,
    };
  }

  const address = body.address;
  if (typeof address !== "string" || address.trim().length < 8 || address.length > 300 || !/\b\d{5}\b/.test(address)) {
    throw invalid("Enter a U.S. address with a ZIP code to find matching election races.");
  }
  let resolved = null;
  try { resolved = await resolveElectionGeography(address); } catch { /* try trusted state-only fallback below */ }
  if (resolved) {
    return {
      state: resolved.state,
      district: resolved.district,
      status: resolved.status === "verified" ? "verified" : "state-only",
      evidenceId: null,
      geography: resolved.geographyEvidence,
    };
  }
  try {
    const legacy = await getDistrictFromAddress(address);
    return { state: legacy.state, district: null, status: "state-only", evidenceId: null, geography: null };
  } catch {
    return { state: null, district: null, status: "unavailable", evidenceId: null, geography: null };
  }
}

function scopeFor(state, chamber) {
  const offices=chamber === 'all' ? ['house','senate'] : [chamber];
  return {
    ...RELEASE_SCOPE,
    states: [state],
    offices,
  };
}

function emptyRoster(geography) {
  return {
    geography: publicGeography(geography),
    candidates: [],
    coverage: {
      status: "unknown",
      byOffice: {
        house: geography.state ? "geography-unverified" : "geography-unavailable",
        senate: geography.state ? "unknown" : "geography-unavailable",
      },
      message: geography.state ? "Candidate coverage has not been confirmed for this location." : "Election geography could not be resolved for this address.",
      runStatus: null,
    },
    availability: {
      overall: geography.state ? "coverage-unknown" : "geography-unavailable",
      house: geography.state ? "geography-unverified" : "geography-unavailable",
      senate: geography.state ? "coverage-unknown" : "geography-unavailable",
    },
    builds: [],
  };
}

function positionForClient(item) {
  const stance = item.response?.stance === "approve" ? "agree"
    : item.response?.stance === "disapprove" ? "disagree" : null;
  return { ...item, response: stance ? { stance } : null };
}

function respondReadError(res, error) {
  if (error?.code === "ELECTION_FEED_RESTART_REQUIRED") {
    return res.status(409).json({ code: error.code, error: "The Elections publication changed. Restart this feed.", retryable: true, retry: { mode: "refresh" } });
  }
  if (error?.status === 400 || error instanceof TypeError) {
    return res.status(400).json({ code: error.code ?? "INVALID_ELECTION_REQUEST", error: error.message });
  }
  if (/Authentication required|Authenticated user mapping mismatch/.test(error?.message ?? "")) {
    return res.status(401).json({ code: "AUTHENTICATION_REQUIRED", error: "Sign in to use this Elections feature." });
  }
  console.error("Elections API request failed", error);
  return res.status(503).json({ code: "ELECTIONS_READ_FAILED", error: "Elections could not be loaded. Please retry.", retryable: true, retry: { mode: "same-request" } });
}

router.post("/roster", async (req, res) => {
  try {
    const body = requestBody(req);
    const options = parseReadOptions({ ...body, limit: 20 });
    const auth = authFor(req);
    const geography = await resolveRequestGeography(req, body, auth);
    if (!geography.state) return res.json(emptyRoster(geography));
    const scope=scopeFor(geography.state,options.chamber);
    const builds=await ensureElectionFeedBuildJobs({state:geography.state,district:geography.district,offices:scope.offices});
    dispatchElectionFeedBuilds(builds);
    const result = await readElectionRoster({
      state: geography.state,
      geography: geography.geography,
      chamber: options.chamber,
      scope,
    });
    return res.json({ ...result, geography: publicGeography(geography), builds });
  } catch (error) { return respondReadError(res, error); }
});

router.post("/feed", async (req, res) => {
  try {
    const body = requestBody(req);
    const options = parseReadOptions(body);
    const auth = authFor(req);
    const geography = await resolveRequestGeography(req, body, auth);
    if (!geography.state) {
      return res.json({ ...emptyRoster(geography), items: [], snapshotId: null, nextCursor: null,
        policyCounts: { all: null, uncategorized: null, byPolicyArea: {} }, availability: "geography-unavailable", builds: [] });
    }
    const scope = scopeFor(geography.state, options.chamber);
    const builds=await ensureElectionFeedBuildJobs({state:geography.state,district:geography.district,offices:scope.offices});
    dispatchElectionFeedBuilds(builds);
    const result = await readElectionPositions({
      state: geography.state,
      district: geography.district,
      geographyEvidenceId: geography.evidenceId,
      geography: geography.geography,
      candidacyId: options.candidacyId,
      policyArea: options.policyArea,
      scope,
      limit: options.limit,
      cursor: options.cursor,
    }, auth);
    return res.json({
      geography: publicGeography(geography),
      items: result.items.map(positionForClient),
      snapshotId: result.snapshotId,
      nextCursor: result.nextCursor,
      availability: result.availability,
      coverage: result.coverage,
      houseAvailability: result.houseAvailability,
      policyCounts: result.policyCounts,
      builds,
    });
  } catch (error) { return respondReadError(res, error); }
});

router.post("/build-status", async (req,res)=>{
  try {
    const body=requestBody(req);
    const options=parseReadOptions({...body,limit:1,cursor:null});
    const auth=authFor(req);
    const geography=await resolveRequestGeography(req,body,auth);
    if (!geography.state) return res.json({geography:publicGeography(geography),builds:[]});
    const scope=scopeFor(geography.state,options.chamber);
    const builds=await ensureElectionFeedBuildJobs({state:geography.state,district:geography.district,offices:scope.offices});
    dispatchElectionFeedBuilds(builds);
    return res.json({geography:publicGeography(geography),builds});
  } catch (error) { return respondReadError(res,error); }
});

router.post("/policy-counts", async (req, res) => {
  try {
    const body = requestBody(req);
    const options = parseReadOptions({ ...body, limit: 1, cursor: null, policyArea: null });
    const auth = authFor(req);
    const geography = await resolveRequestGeography(req, body, auth);
    if (!geography.state) return res.json({ all: null, uncategorized: null, byPolicyArea: {} });
    const result = await readElectionPositions({
      state: geography.state, district: geography.district, geographyEvidenceId: geography.evidenceId,
      geography: geography.geography, candidacyId: options.candidacyId,
      scope: scopeFor(geography.state, options.chamber), limit: 1,
    }, auth);
    return res.json(result.policyCounts);
  } catch (error) { return respondReadError(res, error); }
});

router.post("/alignment", async (req, res) => {
  try {
    const body = requestBody(req);
    const options = parseReadOptions({ ...body, limit: 1, cursor: null });
    if (!options.candidacyId) throw invalid("A candidate must be selected to read alignment.");
    const auth = authFor(req);
    if (!auth) return res.json({ status: "sign-in-required", agreementCount: 0, disagreementCount: 0, answeredCount: 0, percentage: null });
    const geography = await resolveRequestGeography(req, body, auth);
    if (!geography.state) return res.json({ status: "no-answers", agreementCount: 0, disagreementCount: 0, answeredCount: 0, percentage: null });
    const result = await readElectionPositions({
      state: geography.state, district: geography.district, geographyEvidenceId: geography.evidenceId,
      geography: geography.geography, candidacyId: options.candidacyId, policyArea: options.policyArea,
      scope: scopeFor(geography.state, options.chamber), limit: 1,
    }, auth);
    return res.json(result.alignment ?? { status: "no-answers", agreementCount: 0, disagreementCount: 0, answeredCount: 0, percentage: null });
  } catch (error) { return respondReadError(res, error); }
});

router.put("/responses/:positionVersionId", requireElectionUser, async (req, res) => {
  try {
    if (!UUID.test(req.params.positionVersionId)) throw invalid("Invalid position version ID.");
    const body = requestBody(req);
    if (Object.hasOwn(body, "userId") || Object.hasOwn(body, "user_id") || Object.hasOwn(body, "privateComment") || Object.hasOwn(body, "private_comment")) {
      throw invalid("Only a public stance can be changed through the Elections API.");
    }
    if (!["agree", "disagree"].includes(body.stance)) throw invalid("Stance must be agree or disagree.");
    const auth = authFor(req);
    const result = await saveElectionResponse(auth, {
      positionVersionId: req.params.positionVersionId,
      stance: body.stance === "agree" ? "approve" : "disapprove",
    });
    if (!result) return res.status(404).json({ code: "POSITION_VERSION_NOT_CURRENT", error: "That campaign position is no longer available." });
    return res.json({ status: "confirmed", response: { positionVersionId: req.params.positionVersionId, stance: body.stance } });
  } catch (error) { return respondReadError(res, error); }
});

router.delete("/responses/:positionVersionId", requireElectionUser, async (req, res) => {
  try {
    if (!UUID.test(req.params.positionVersionId)) throw invalid("Invalid position version ID.");
    const auth = authFor(req);
    const result = await clearElectionResponse(auth, req.params.positionVersionId);
    if (!result) return res.status(404).json({ code: "POSITION_VERSION_NOT_CURRENT", error: "That campaign position is no longer available." });
    return res.json({ status: "confirmed", response: { positionVersionId: req.params.positionVersionId, stance: null } });
  } catch (error) { return respondReadError(res, error); }
});

export default router;
