const FIXTURE_DATA_ENABLED = import.meta.env?.DEV === true &&
  import.meta.env?.VITE_ELECTION_FIXTURES === "true";

const VISUAL_CANDIDATE_COUNTS = new Set([0, 1, 2, 3, 5, 7]);
const RESPONSE_STATES = new Set([
  "neutral", "agreement", "disagreement", "mixed", "zero", "seventy-five",
]);
const GEOGRAPHY_STATES = new Set(["verified", "state-only", "unavailable"]);
const RACE_STATES = new Set(["confirmed-none"]);
const CANDIDATE_AVAILABILITY_STATES = new Set([
  "site-missing", "site-unverified", "crawl-failed", "extraction-failed",
]);
const BUILD_SCENARIOS = new Set(["none", "running", "failed", "partial", "refresh-failure"]);
const FIXTURE_FAILURES = new Set([
  "roster", "positions:first-page", "positions:next-page", "policy-counts",
  "alignment", "save-response", "clear-response", "build-status",
]);

function boundedInteger(value, minimum, maximum) {
  if (!/^\d+$/.test(value ?? "")) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum
    ? number
    : null;
}

function parseFailures(params) {
  const failures = [];
  for (const value of params.getAll("electionsFail")) {
    for (const failure of value.split(",").map(item => item.trim()).filter(Boolean)) {
      if (FIXTURE_FAILURES.has(failure) && !failures.includes(failure)) failures.push(failure);
    }
  }
  return failures;
}

function parseFailAt(params) {
  const failures = {};
  for (const value of params.getAll("electionsFailAt")) {
    const separator = value.lastIndexOf(":");
    if (separator < 1) continue;
    const operation = value.slice(0, separator);
    const call = boundedInteger(value.slice(separator + 1), 1, 100);
    if (FIXTURE_FAILURES.has(operation) && call !== null) failures[operation] = call;
  }
  return failures;
}

/**
 * Parse an explicit, development-only Elections fixture URL. Invalid or
 * unrelated routes never opt into the fixture preview.
 */
export function parseElectionFixturePreviewLocation(
  pathname,
  search,
  { enabled = FIXTURE_DATA_ENABLED } = {},
) {
  if (!enabled || pathname !== "/feed") return null;
  const params = new URLSearchParams(search);
  const visualCandidateCount = boundedInteger(params.get("electionsVisual"), 0, 7);
  const validVisualCount = VISUAL_CANDIDATE_COUNTS.has(visualCandidateCount);
  const normalFixture = params.get("electionsFixture") === "normal";
  const responseState = params.get("electionsResponseState");
  const geographyState = params.get("electionsGeography");
  const raceState = params.get("electionsRaceStatus");
  const candidateAvailabilityState = params.get("electionsCandidateAvailability");
  const coverageScenario = params.get("electionsCoverage");
  const validRaceState = RACE_STATES.has(raceState);
  const validCandidateAvailabilityState = CANDIDATE_AVAILABILITY_STATES.has(candidateAvailabilityState);
  const validCoverageScenario = coverageScenario === "partial" || coverageScenario === "unknown";
  if (!normalFixture && !validVisualCount && !validRaceState &&
      !validCandidateAvailabilityState && !validCoverageScenario) return null;

  const buildScenario = params.get("electionsBuild");
  const latencyMs = boundedInteger(params.get("electionsDelay"), 0, 10000);
  const pageSize = boundedInteger(params.get("electionsPageSize"), 1, 50);

  return Object.freeze({
    visualCandidateCount: validVisualCount ? visualCandidateCount : null,
    brokenVisualPortrait: params.get("electionsPortrait") === "broken",
    simulatedViewer: params.get("electionsViewer") === "simulated",
    latencyMs: latencyMs ?? 0,
    pageSize: pageSize ?? undefined,
    invalidateCursorOnce: params.get("electionsCursor") === "invalidated",
    sourceUnavailable: params.get("electionsSource") === "unavailable",
    failures: Object.freeze(parseFailures(params)),
    failAt: Object.freeze(parseFailAt(params)),
    responseState: RESPONSE_STATES.has(responseState) ? responseState : null,
    geographyStatus: GEOGRAPHY_STATES.has(geographyState) ? geographyState : "verified",
    raceStatus: validRaceState ? raceState : null,
    candidateAvailabilityScenario: validCandidateAvailabilityState
      ? candidateAvailabilityState
      : null,
    coverageStatus: coverageScenario === "unknown" ? "unknown" : "partial",
    buildScenario: BUILD_SCENARIOS.has(buildScenario) ? buildScenario : "none",
    showCoverageNotice: coverageScenario === "partial" || coverageScenario === "unknown",
  });
}

export function isElectionFixturePreviewLocation(pathname, search) {
  return parseElectionFixturePreviewLocation(pathname, search) !== null;
}
