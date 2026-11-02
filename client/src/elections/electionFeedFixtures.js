import {
  ELECTION_CHAMBERS,
  ELECTION_RESPONSE_STANCES,
  createElectionFeedClient,
} from "./electionFeedClient.js";

export const ELECTION_FIXTURE_LABEL =
  "Development fixture data — fictional candidates, not live election results";

const DEFAULT_GEOGRAPHY = Object.freeze({
  status: "verified",
  state: "NY",
  houseDistrict: 13,
});
const FIXTURE_PAGE_SIZE = 3;
const FIXTURE_FAILURES = new Set([
  "roster",
  "positions:first-page",
  "positions:next-page",
  "policy-counts",
  "alignment",
  "save-response",
  "clear-response",
  "build-status",
]);
const CANDIDATE_AVAILABILITY_STATES = new Set([
  "site-missing", "site-unverified", "crawl-failed", "extraction-failed",
]);

function portraitSvg(background, shirt, hair) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="${background}"/><path d="M13 120c4-28 21-42 47-42s43 14 47 42" fill="${shirt}"/><ellipse cx="60" cy="48" rx="25" ry="31" fill="#edc7a7"/><path d="M34 49c-4-28 8-41 27-41 19 0 29 13 26 39-7-3-13-10-17-17-8 10-21 16-36 19z" fill="${hair}"/><circle cx="51" cy="49" r="2" fill="#263238"/><circle cx="69" cy="49" r="2" fill="#263238"/><path d="M53 64q7 5 14 0" fill="none" stroke="#9e5d52" stroke-width="2" stroke-linecap="round"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const HOUSE_RACE = Object.freeze({
  office: "house",
  state: "NY",
  district: 13,
  senateSeat: null,
  electionDate: "2026-11-03",
  stage: "general",
  contestType: "regular",
});
const SENATE_RACE = Object.freeze({
  office: "senate",
  state: "NY",
  district: null,
  senateSeat: 1,
  electionDate: "2026-11-03",
  stage: "general",
  contestType: "regular",
});

const CANDIDACIES = Object.freeze([
  {
    candidacyId: "fixture-candidacy-house-a",
    candidateId: "fixture-person-house-a",
    name: "Avery Example",
    race: HOUSE_RACE,
    party: "Democratic Party",
    incumbency: "incumbent",
    portraitUrl: portraitSvg("#dbeafe", "#1d4ed8", "#3b3029"),
    ballotStatus: "unknown",
    registrationStatus: "fec-registered",
    availability: "available",
  },
  {
    candidacyId: "fixture-candidacy-house-b",
    candidateId: "fixture-person-house-b",
    name: "Blake Example",
    race: HOUSE_RACE,
    party: "Republican Party",
    incumbency: "unknown",
    portraitUrl: null,
    ballotStatus: "unknown",
    registrationStatus: "fec-registered",
    availability: "available",
  },
  {
    candidacyId: "fixture-candidacy-house-c",
    candidateId: "fixture-person-house-c",
    name: "Cameron Example",
    race: HOUSE_RACE,
    party: "Independent",
    incumbency: "not-incumbent",
    portraitUrl: null,
    ballotStatus: "ballot-confirmed",
    registrationStatus: "state-listed",
    availability: "no-positions",
  },
  {
    candidacyId: "fixture-candidacy-senate-a",
    candidateId: "fixture-person-senate-a",
    name: "Dakota Example",
    race: SENATE_RACE,
    party: "Democratic Party",
    incumbency: "incumbent",
    portraitUrl: portraitSvg("#ede9fe", "#5b21b6", "#332b2c"),
    ballotStatus: "ballot-confirmed",
    registrationStatus: "fec-registered",
    availability: "available",
  },
  {
    candidacyId: "fixture-candidacy-senate-b",
    candidateId: "fixture-person-senate-b",
    name: "Ellis Example",
    race: SENATE_RACE,
    party: null,
    incumbency: "unknown",
    portraitUrl: null,
    ballotStatus: "unknown",
    registrationStatus: "state-listed",
    availability: "no-positions",
  },
]);

const VISUAL_CANDIDATE_COPY = Object.freeze({
  "fixture-candidacy-house-a": { name: "Avery Example", responseDisplayName: "Avery" },
  "fixture-candidacy-house-b": { name: "Blake L. Example-Watson", responseDisplayName: "Blake" },
  "fixture-candidacy-house-c": { name: "Cameron De La Example-Washington", responseDisplayName: "Cameron" },
  "fixture-candidacy-senate-a": { name: "Dakota Example", responseDisplayName: "Dakota" },
  "fixture-candidacy-senate-b": { name: "Ellis Montgomery Example Jr.", responseDisplayName: "Ellis" },
});

const VISUAL_ONLY_CANDIDACIES = Object.freeze([
  {
    candidacyId: "visual-layout-candidacy-house-six",
    candidateId: "visual-layout-person-house-six",
    name: "Florence B. Northwood",
    responseDisplayName: "Florence",
    race: HOUSE_RACE,
    party: "Working Families Party",
    incumbency: "unknown",
    portraitUrl: null,
    ballotStatus: "unknown",
    registrationStatus: "not-evaluated",
    availability: "no-positions",
  },
  {
    candidacyId: "visual-layout-candidacy-senate-seven",
    candidateId: "visual-layout-person-senate-seven",
    name: "Gabriel De La Cruz-Example",
    responseDisplayName: "Gabriel",
    race: SENATE_RACE,
    party: "Green Party",
    incumbency: "unknown",
    portraitUrl: null,
    ballotStatus: "unknown",
    registrationStatus: "not-evaluated",
    availability: "no-positions",
  },
]);

const VISUAL_POSITION_SUMMARIES = Object.freeze({
  "fixture-position-version-house-a-housing":
    "Expand affordable housing by rehabilitating vacant homes, preserving rent-stabilized apartments, and supporting first-time buyers with down-payment assistance.",
  "fixture-position-version-house-b-immigration":
    "Support faster work-permit processing while expanding immigration court capacity and preserving access to legal counsel for families awaiting a hearing.",
});

const CANDIDACY_BY_ID = new Map(
  CANDIDACIES.map((candidate) => [candidate.candidacyId, candidate]),
);

function makePosition({ id, candidacyId, topic, summary }) {
  const candidacy = CANDIDACY_BY_ID.get(candidacyId);
  return Object.freeze({
    positionVersionId: `fixture-position-version-${id}`,
    claimId: `fixture-claim-${id}`,
    candidacyId,
    topic,
    summary,
    excerpt: summary,
    candidate: candidacy,
    race: candidacy.race,
    source: Object.freeze({
      url: `https://example.invalid/elections/fixture/${id}`,
      retrievedAt: "2026-10-27T15:00:00.000Z",
    }),
    ballotStatus: candidacy.ballotStatus,
    registrationStatus: candidacy.registrationStatus,
    availability: candidacy.availability,
  });
}

const POSITIONS = Object.freeze([
  makePosition({
    id: "house-a-housing",
    candidacyId: "fixture-candidacy-house-a",
    topic: "housing",
    summary: "Expand affordable housing by rehabilitating vacant homes and supporting first-time buyers.",
  }),
  makePosition({
    id: "house-b-immigration",
    candidacyId: "fixture-candidacy-house-b",
    topic: "immigration",
    summary: "Support faster work-permit processing and more immigration court capacity.",
  }),
  makePosition({
    id: "house-a-economy",
    candidacyId: "fixture-candidacy-house-a",
    topic: "economy",
    summary: "Support small-business lending and paid apprenticeships in high-demand trades.",
  }),
  makePosition({
    id: "senate-a-environment",
    candidacyId: "fixture-candidacy-senate-a",
    topic: "environment",
    summary: "Invest in grid upgrades and clean-energy manufacturing.",
  }),
  makePosition({
    id: "house-a-healthcare",
    candidacyId: "fixture-candidacy-house-a",
    topic: "healthcare",
    summary: "Expand community health clinics and protect access to preventive care.",
  }),
  makePosition({
    id: "house-b-safety",
    candidacyId: "fixture-candidacy-house-b",
    topic: "public-safety",
    summary: "Fund local violence-prevention programs with public outcome reporting.",
  }),
  makePosition({
    id: "house-a-education",
    candidacyId: "fixture-candidacy-house-a",
    topic: "education",
    summary: "Increase federal support for school buildings and after-school programs.",
  }),
  makePosition({
    id: "senate-a-foreign-policy",
    candidacyId: "fixture-candidacy-senate-a",
    topic: "foreign-policy",
    summary: "Require public reporting before major changes to overseas security assistance.",
  }),
  makePosition({
    id: "house-a-uncategorized",
    candidacyId: "fixture-candidacy-house-a",
    topic: null,
    summary: "Publish plain-language reports on district infrastructure grant spending.",
  }),
]);

const INITIAL_RESPONSES = Object.freeze([
  ["fixture-position-version-house-a-housing", "agree"],
  ["fixture-position-version-house-a-economy", "agree"],
  ["fixture-position-version-house-a-healthcare", "agree"],
  ["fixture-position-version-house-a-education", "disagree"],
  // A response to an old version is deliberately absent from POSITIONS.
  ["fixture-position-version-superseded", "agree"],
]);

const POLICY_KEYS = Object.freeze([
  "economy",
  "healthcare",
  "housing",
  "education",
  "environment",
  "immigration",
  "civil-rights",
  "public-safety",
  "foreign-policy",
  "government",
  "other",
]);

function copy(value) {
  return structuredClone(value);
}

function normalizeScope(scope = {}) {
  const geography = { ...DEFAULT_GEOGRAPHY, ...scope.geography };
  const chamber = scope.chamber ?? "all";
  if (!ELECTION_CHAMBERS.includes(chamber)) {
    throw new TypeError(`Unsupported Elections chamber: ${chamber}`);
  }
  if (!["verified", "state-only", "unavailable"].includes(geography.status)) {
    throw new TypeError(`Unsupported election geography status: ${geography.status}`);
  }
  return {
    geography,
    chamber,
    candidacyId: scope.candidacyId ?? null,
    policyArea: scope.policyArea ?? null,
  };
}

function matchesGeography(candidate, geography) {
  if (!geography.state || geography.status === "unavailable") return false;
  if (candidate.race.state !== geography.state) return false;
  if (candidate.race.office === "house") {
    return geography.status === "verified" &&
      candidate.race.district === geography.houseDistrict;
  }
  return true;
}

function isInChamber(candidate, chamber) {
  return chamber === "all" || candidate.race.office === chamber;
}

function candidatesForScope(scope, { keepRoster = false, visualCandidates = null } = {}) {
  const normalized = normalizeScope(scope);
  const candidates = visualCandidates ?? CANDIDACIES;
  return candidates.filter((candidate) =>
    (visualCandidates !== null || candidate.ballotStatus === "ballot-confirmed") &&
    matchesGeography(candidate, normalized.geography) &&
    isInChamber(candidate, normalized.chamber) &&
    (keepRoster || normalized.candidacyId === null ||
      candidate.candidacyId === normalized.candidacyId),
  );
}

function basePositionsForScope(scope, visualCandidates = null) {
  const normalized = normalizeScope(scope);
  const candidates = candidatesForScope(normalized, { visualCandidates });
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidacyId, candidate]));
  return POSITIONS.filter((position) => candidatesById.has(position.candidacyId))
    .map((position) => {
      const summary = visualCandidates
        ? VISUAL_POSITION_SUMMARIES[position.positionVersionId]
        : null;
      return {
        ...position,
        candidate: candidatesById.get(position.candidacyId),
        ...(summary ? { summary, excerpt: summary } : {}),
      };
    });
}

function policyCountsForScope(scope, visualCandidates = null) {
  const completeSet = basePositionsForScope(scope, visualCandidates);
  const byPolicyArea = Object.fromEntries(POLICY_KEYS.map((key) => [key, 0]));
  let uncategorized = 0;
  for (const position of completeSet) {
    if (position.topic === null) uncategorized += 1;
    else byPolicyArea[position.topic] = (byPolicyArea[position.topic] ?? 0) + 1;
  }
  return {
    dataMode: "development-fixture",
    all: completeSet.length,
    uncategorized,
    byPolicyArea,
  };
}

function coverageForScope(scope, status = "partial", raceStatus = null) {
  const geography = normalizeScope(scope).geography;
  const house = geography.status === "verified" ? "partial" : "geography-unverified";
  if (raceStatus === "confirmed-none") {
    const byOffice = {
      house: geography.status === "verified" ? "no-race" : "geography-unverified",
      senate: geography.state ? "no-race" : "geography-unavailable",
    };
    const complete = Object.values(byOffice).every(value => value === "no-race");
    return {
      status: complete ? "complete" : "partial",
      byOffice,
      message: "Synthetic development fixture: no-race status is not a live election result.",
    };
  }
  if (status === "unknown") {
    return {
      status: "unknown",
      byOffice: { house: "unknown", senate: "unknown" },
      message: "Development fixture coverage is intentionally unverified; this preview makes no ballot-completeness claim.",
    };
  }
  return {
    status: "partial",
    byOffice: { house, senate: geography.state ? "complete" : "unknown" },
    message: "Development fixture coverage is illustrative, not a ballot-completeness claim.",
  };
}

function availabilityForScope(scope, candidates, raceStatus = null) {
  const geography = normalizeScope(scope).geography;
  if (raceStatus === "confirmed-none") {
    const house = geography.status === "verified" ? "no-race" : "geography-unverified";
    const senate = geography.state ? "no-race" : "geography-unavailable";
    return {
      overall: house === "no-race" && senate === "no-race" ? "no-race" : "coverage-unknown",
      house,
      senate,
    };
  }
  const house = geography.status !== "verified"
    ? "geography-unverified"
    : candidates.some(({ race }) => race.office === "house") ? "available" : "coverage-unknown";
  const senate = geography.state
    ? candidates.some(({ race }) => race.office === "senate") ? "available" : "coverage-unknown"
    : "geography-unavailable";
  return {
    overall: candidates.length > 0 ? "available" : "coverage-unknown",
    house,
    senate,
  };
}

function waitForFixture(latencyMs, signal) {
  if (signal?.aborted) {
    const error = new Error("Fixture request aborted.");
    error.name = "AbortError";
    return Promise.reject(error);
  }
  if (latencyMs <= 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      const error = new Error("Fixture request aborted.");
      error.name = "AbortError";
      reject(error);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, latencyMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwFixtureFailure(operation, failures, failAt, callNumber) {
  if (!failures.has(operation) && failAt[operation] !== callNumber) return;
  const error = new Error(`Configured Elections fixture failure: ${operation}`);
  error.code = "ELECTION_FIXTURE_FAILURE";
  error.operation = operation;
  throw error;
}

function scopeKey(scope) {
  return encodeURIComponent(JSON.stringify(normalizeScope(scope)));
}

function makeCursor(key, snapshotId, offset) {
  return `fixture:${key}:${snapshotId}:${offset}`;
}

function readCursor(cursor, key, snapshotId) {
  const parts = String(cursor).split(":");
  const offset = Number(parts.at(-1));
  if (parts.length !== 4 || parts[0] !== "fixture" || parts[1] !== key ||
      parts[2] !== snapshotId || !Number.isInteger(offset) || offset < 0) {
    const error = new Error("Fixture publication changed or cursor is invalid; restart from the first page.");
    error.code = "ELECTION_FIXTURE_CURSOR_INVALID";
    error.restartFromFirstPage = true;
    throw error;
  }
  return offset;
}

/**
 * Create a deterministic, development-only implementation of the Elections
 * data interface. No application route imports this module by default.
 *
 * @param {{pageSize?: number, latencyMs?: number, failures?: string[], failAt?: Record<string, number>, responseState?: string, visualCandidateCount?: number, brokenVisualPortrait?: boolean, invalidateCursorOnce?: boolean, sourceUnavailable?: boolean, geographyStatus?: string, raceStatus?: string|null, candidateAvailabilityScenario?: string|null, coverageStatus?: string, buildScenario?: string}} [options]
 */
export function createElectionFixtureClient({
  pageSize = FIXTURE_PAGE_SIZE,
  latencyMs = 0,
  failures = [],
  failAt = {},
  responseState = null,
  visualCandidateCount = null,
  brokenVisualPortrait = false,
  invalidateCursorOnce = false,
  sourceUnavailable = false,
  geographyStatus = "verified",
  raceStatus = null,
  candidateAvailabilityScenario = null,
  coverageStatus = "partial",
  buildScenario = "none",
} = {}) {
  if (import.meta.env?.DEV !== true) {
    throw new Error("Elections fixture data can only be used in a Vite development build.");
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw new TypeError("Fixture page size must be between 1 and 50.");
  }
  if (!Number.isFinite(latencyMs) || latencyMs < 0) {
    throw new TypeError("Fixture latency must be a non-negative number.");
  }
  if (visualCandidateCount !== null && ![0, 1, 2, 3, 5, 7].includes(visualCandidateCount)) {
    throw new TypeError("Visual fixture candidate count must be 0, 1, 2, 3, 5, or 7.");
  }
  const invalidFailures = failures.filter((failure) => !FIXTURE_FAILURES.has(failure));
  if (invalidFailures.length > 0) {
    throw new TypeError(`Unsupported Elections fixture failures: ${invalidFailures.join(", ")}`);
  }
  const configuredFailAt = { ...failAt };
  if (buildScenario === "refresh-failure" && configuredFailAt["positions:first-page"] === undefined) {
    configuredFailAt["positions:first-page"] = 2;
  }
  const invalidFailAt = Object.entries(configuredFailAt).filter(([operation, call]) =>
    !FIXTURE_FAILURES.has(operation) || !Number.isInteger(call) || call < 1 || call > 100);
  if (invalidFailAt.length > 0) {
    throw new TypeError("Fixture failAt entries require a supported operation and call number from 1 to 100.");
  }
  if (!new Set(["neutral", "agreement", "disagreement", "mixed", "zero", "seventy-five", null]).has(responseState)) {
    throw new TypeError("Unsupported fixture response state.");
  }
  if (!new Set(["verified", "state-only", "unavailable"]).has(geographyStatus)) {
    throw new TypeError("Unsupported fixture geography status.");
  }
  if (!new Set([null, "confirmed-none"]).has(raceStatus)) {
    throw new TypeError("Unsupported fixture race status.");
  }
  if (!new Set([null, ...CANDIDATE_AVAILABILITY_STATES]).has(candidateAvailabilityScenario)) {
    throw new TypeError("Unsupported fixture candidate availability status.");
  }
  if (!new Set(["partial", "unknown"]).has(coverageStatus)) {
    throw new TypeError("Unsupported fixture coverage status.");
  }
  if (!new Set(["none", "running", "failed", "partial", "refresh-failure"]).has(buildScenario)) {
    throw new TypeError("Unsupported fixture build scenario.");
  }

  const configuredFailures = new Set(failures);
  const responses = new Map(responseState === null || responseState === "mixed" || responseState === "seventy-five"
    ? INITIAL_RESPONSES
    : []);
  if (responseState === "agreement") responses.set(POSITIONS[0].positionVersionId, "agree");
  if (responseState === "disagreement") responses.set(POSITIONS[0].positionVersionId, "disagree");
  if (responseState === "zero") {
    for (const position of POSITIONS) responses.set(position.positionVersionId, "disagree");
  }
  if (responseState === "neutral") responses.clear();
  const visualCandidates = visualCandidateCount === null
    ? null
    : [
      ...CANDIDACIES.map((candidate) => ({
        ...candidate,
        ...VISUAL_CANDIDATE_COPY[candidate.candidacyId],
        ...(brokenVisualPortrait && candidate.candidacyId === "fixture-candidacy-house-a"
          ? { portraitUrl: "/visual-fixture-missing-portrait.png" }
          : {}),
      })),
      ...VISUAL_ONLY_CANDIDACIES,
    ].slice(0, visualCandidateCount);
  const defaultGeography = geographyStatus === "unavailable"
    ? { status: "unavailable", state: null, houseDistrict: null }
    : geographyStatus === "state-only"
      ? { status: "state-only", state: DEFAULT_GEOGRAPHY.state, houseDistrict: null }
      : { ...DEFAULT_GEOGRAPHY };
  function fixtureCandidatesForScope(scope, { keepRoster = false } = {}) {
    return candidatesForScope(scope, { keepRoster, visualCandidates }).map(candidate =>
      candidateAvailabilityScenario && candidate.availability === "no-positions"
        ? { ...candidate, availability: candidateAvailabilityScenario }
        : candidate,
    );
  }
  function fixturePolicyCounts(scope) {
    if (raceStatus === "confirmed-none") {
      return {
        dataMode: "development-fixture",
        all: 0,
        uncategorized: 0,
        byPolicyArea: Object.fromEntries(POLICY_KEYS.map(key => [key, 0])),
      };
    }
    return policyCountsForScope(scope, visualCandidates);
  }
  const operationCalls = new Map();
  let buildStatusReads = 0;
  let publicationRevision = 1;
  let cursorInvalidated = false;

  function buildJobs() {
    if (buildScenario === "none") return [];
    if (buildScenario === "failed" || buildScenario === "partial") {
      return [{
        id: `fixture-build-${buildScenario}`,
        status: buildScenario,
        updatedAt: new Date().toISOString(),
      }];
    }
    const completed = buildStatusReads >= 2;
    return completed ? [] : [{
      id: `fixture-build-${buildScenario}`,
      status: "running",
      updatedAt: new Date().toISOString(),
    }];
  }

  async function wait(operation, signal, continuation = false) {
    const failureKey = operation === "positions"
      ? `positions:${continuation ? "next-page" : "first-page"}`
      : operation;
    await waitForFixture(latencyMs, signal);
    if (signal?.aborted) {
      const error = new Error("Fixture request aborted.");
      error.name = "AbortError";
      throw error;
    }
    const callNumber = (operationCalls.get(failureKey) ?? 0) + 1;
    operationCalls.set(failureKey, callNumber);
    throwFixtureFailure(failureKey, configuredFailures, configuredFailAt, callNumber);
  }

  const client = createElectionFeedClient({
    async readRoster(scope, { signal } = {}) {
      await wait("roster", signal);
      const normalized = normalizeScope({ ...scope, geography: scope?.geography ?? defaultGeography });
      const candidates = raceStatus === "confirmed-none"
        ? []
        : fixtureCandidatesForScope(normalized, { keepRoster: true });
      return {
        dataMode: "development-fixture",
        candidates: copy(candidates),
        geography: copy(normalized.geography),
        visualLayoutOnly: visualCandidates !== null,
        coverage: copy(coverageForScope(normalized, coverageStatus, raceStatus)),
        availability: copy(availabilityForScope(normalized, candidates, raceStatus)),
        builds: copy(buildJobs()),
      };
    },

    async readBuildStatus(_scope, { signal } = {}) {
      await wait("build-status", signal);
      buildStatusReads += 1;
      return { builds: copy(buildJobs()) };
    },

    async readPositions(scope, { limit = pageSize, cursor = null, signal, viewer = "signed-in" } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new TypeError("Fixture page limit must be between 1 and 50.");
      }
      const normalized = normalizeScope({ ...scope, geography: scope?.geography ?? defaultGeography });
      const key = scopeKey(normalized);
      if (invalidateCursorOnce && cursor !== null && !cursorInvalidated) {
        publicationRevision += 1;
        cursorInvalidated = true;
      }
      const snapshotId = `fixture-publication-${publicationRevision}`;
      const offset = cursor === null ? 0 : readCursor(cursor, key, snapshotId);
      await wait("positions", signal, cursor !== null);

      const completeSet = raceStatus === "confirmed-none"
        ? []
        : basePositionsForScope(normalized, visualCandidates);
      const filtered = normalized.policyArea === null
        ? completeSet
        : completeSet.filter(({ topic }) => normalized.policyArea === "uncategorized"
          ? topic == null
          : topic === normalized.policyArea);
      const items = filtered.slice(offset, offset + Math.min(limit, pageSize)).map((position, index) => {
        const item = copy(position);
        if (sourceUnavailable && offset + index === 0 && item.source) {
          item.source.url = null;
        }
        return {
          ...item,
          response: viewer === "guest" ? null : responses.has(position.positionVersionId)
            ? { stance: responses.get(position.positionVersionId) }
            : null,
        };
      });
      const nextOffset = offset + items.length;
      const selectedCandidate = normalized.candidacyId === null
        ? null
        : fixtureCandidatesForScope(normalized)[0];
      const candidateAvailability = selectedCandidate?.availability;
      const candidateWithNoPositions = candidateAvailability === "no-positions" ||
        CANDIDATE_AVAILABILITY_STATES.has(candidateAvailability);
      let availability = items.length > 0 ? "available" : "coverage-unknown";
      if (raceStatus === "confirmed-none") {
        availability = normalized.chamber === "house" && normalized.geography.status !== "verified"
          ? "geography-unverified"
          : normalized.geography.status === "unavailable" ? "geography-unavailable" : "no-race";
      } else if (selectedCandidate && candidateWithNoPositions) availability = candidateAvailability;
      else if (completeSet.length > 0 && filtered.length === 0) availability = "no-topic-match";
      else if (normalized.chamber === "house" && normalized.geography.status !== "verified") {
        availability = "geography-unverified";
      } else if (normalized.geography.status === "unavailable") {
        availability = "geography-unavailable";
      }

      return {
        dataMode: "development-fixture",
        items,
        snapshotId,
        nextCursor: nextOffset < filtered.length
          ? makeCursor(key, snapshotId, nextOffset)
          : null,
        policyCounts: fixturePolicyCounts(normalized),
        availability,
        coverage: coverageForScope(normalized, coverageStatus, raceStatus),
        builds: copy(buildJobs()),
      };
    },

    async readPolicyCounts(scope, { signal } = {}) {
      await wait("policy-counts", signal);
      return fixturePolicyCounts(scope);
    },

    async readAlignment(scope, { signal, viewer = "signed-in" } = {}) {
      await wait("alignment", signal);
      const normalized = normalizeScope(scope);
      if (!normalized.candidacyId) {
        throw new TypeError("Fixture alignment requires a candidacy ID.");
      }
      if (viewer === "guest") {
        return {
          dataMode: "development-fixture",
          status: "sign-in-required",
          agreementCount: 0,
          disagreementCount: 0,
          answeredCount: 0,
          percentage: null,
        };
      }
      const positions = basePositionsForScope(normalized, visualCandidates).filter((position) =>
        normalized.policyArea === null || (normalized.policyArea === "uncategorized"
          ? position.topic == null
          : position.topic === normalized.policyArea),
      );
      let agreementCount = 0;
      let disagreementCount = 0;
      for (const position of positions) {
        const stance = responses.get(position.positionVersionId);
        if (stance === "agree") agreementCount += 1;
        if (stance === "disagree") disagreementCount += 1;
      }
      const answeredCount = agreementCount + disagreementCount;
      return {
        dataMode: "development-fixture",
        status: answeredCount > 0 ? "ready" : "no-answers",
        agreementCount,
        disagreementCount,
        answeredCount,
        percentage: answeredCount > 0
          ? Math.round((agreementCount / answeredCount) * 100)
          : null,
      };
    },

    async saveResponse({ positionVersionId, stance }, { signal, viewer = "signed-in" } = {}) {
      await wait("save-response", signal);
      if (viewer === "guest") return { status: "sign-in-required", response: null };
      if (!ELECTION_RESPONSE_STANCES.includes(stance)) {
        throw new TypeError("Fixture response stance must be agree or disagree.");
      }
      if (!POSITIONS.some((position) => position.positionVersionId === positionVersionId)) {
        throw new TypeError("Fixture response must identify a current position version.");
      }
      responses.set(positionVersionId, stance);
      return {
        status: "confirmed",
        response: { positionVersionId, stance },
      };
    },

    async clearResponse({ positionVersionId }, { signal, viewer = "signed-in" } = {}) {
      await wait("clear-response", signal);
      if (viewer === "guest") return { status: "sign-in-required", response: null };
      if (!POSITIONS.some((position) => position.positionVersionId === positionVersionId)) {
        throw new TypeError("Fixture response must identify a current position version.");
      }
      responses.delete(positionVersionId);
      return {
        status: "confirmed",
        response: { positionVersionId, stance: null },
      };
    },
  });

  return Object.freeze({
    ...client,
    dataMode: "development-fixture",
    label: ELECTION_FIXTURE_LABEL,
    fixtureScenario: Object.freeze({
      responseState, geographyStatus, raceStatus, candidateAvailabilityScenario,
      coverageStatus, buildScenario,
    }),
    visualScenario: visualCandidateCount === null ? null : Object.freeze({
      candidateCount: visualCandidateCount,
      brokenPortrait: brokenVisualPortrait,
    }),
    fixtureControls: Object.freeze({
      invalidatePublication() {
        publicationRevision += 1;
      },
    }),
  });
}
