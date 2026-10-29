/**
 * Transport-independent data boundary for the Elections UI.
 * The eventual HTTP adapter must implement this interface; this module does
 * not define routes, request bodies, or server response shapes.
 */

export const ELECTION_CHAMBERS = Object.freeze(["all", "house", "senate"]);
export const ELECTION_RESPONSE_STANCES = Object.freeze(["agree", "disagree"]);
export const ELECTION_INCUMBENCY_STATES = Object.freeze([
  "incumbent",
  "not-incumbent",
  "unknown",
]);

/** @typedef {"all" | "house" | "senate"} ElectionChamber */
/** @typedef {"agree" | "disagree"} ElectionResponseStance */
/** @typedef {"incumbent" | "not-incumbent" | "unknown"} ElectionIncumbency */
/** @typedef {"guest" | "signed-in"} ElectionViewer */

/**
 * @typedef {Object} ElectionGeography
 * @property {"verified" | "state-only" | "unavailable"} status
 * @property {string | null} state
 * @property {number | null} houseDistrict
 */

/**
 * @typedef {Object} ElectionFeedScope
 * @property {ElectionGeography} geography Server-resolved election geography; never a raw street address.
 * @property {ElectionChamber} chamber
 * @property {string | null} candidacyId Stable candidacy identity, not a name or current-member ID.
 * @property {string | null} policyArea Null means all policy areas, including uncategorized positions.
 */

/**
 * @typedef {Object} ElectionRace
 * @property {"house" | "senate"} office
 * @property {string} state
 * @property {number | null} district
 * @property {1 | 2 | 3 | null} senateSeat
 * @property {string} electionDate
 * @property {"general"} stage
 * @property {"regular"} contestType
 */

/**
 * @typedef {Object} ElectionCandidacy
 * @property {string} candidacyId
 * @property {string} candidateId
 * @property {string} name
 * @property {ElectionRace} race
 * @property {string | null} party
 * @property {ElectionIncumbency} incumbency Unknown must never render an incumbent badge.
 * @property {string | null} portraitUrl Null selects the initials fallback.
 * @property {string} ballotStatus Keep distinct from FEC registration.
 * @property {string} registrationStatus
 * @property {string} availability
 */

/**
 * @typedef {Object} ElectionPosition
 * @property {string} positionVersionId
 * @property {string} claimId
 * @property {string} candidacyId
 * @property {string | null} topic Null means uncategorized.
 * @property {string} summary
 * @property {string} excerpt
 * @property {ElectionCandidacy} candidate
 * @property {ElectionRace} race
 * @property {{url: string, retrievedAt: string}} source
 * @property {string} ballotStatus
 * @property {string} registrationStatus
 * @property {string} availability
 * @property {{stance: ElectionResponseStance} | null} response
 */

/**
 * @typedef {Object} ElectionCoverage
 * @property {"complete" | "partial" | "unknown"} status
 * @property {Record<string, string>} byOffice
 * @property {string | null} message
 */

/**
 * @typedef {Object} ElectionRosterResult
 * @property {ElectionCandidacy[]} candidates Complete roster for the geography and chamber, independent of policy.
 * @property {ElectionCoverage} coverage
 * @property {{overall: string, house: string, senate: string}} availability
 * @property {ElectionGeography} geography
 */

/**
 * @typedef {Object} ElectionPositionsPage
 * @property {ElectionPosition[]} items
 * @property {string} snapshotId
 * @property {string | null} nextCursor
 * @property {string} availability
 * @property {ElectionCoverage} coverage
 * @property {ElectionPolicyCounts} policyCounts
 * @property {string} availability
 */

/**
 * @typedef {Object} ElectionPolicyCounts
 * @property {number | null} all Full-scope count, including uncategorized positions.
 * @property {number | null} uncategorized Full-scope uncategorized count.
 * @property {Record<string, number | null>} byPolicyArea Full-scope counts before the policy filter.
 */

/**
 * @typedef {Object} ElectionAlignment
 * @property {"ready" | "no-answers" | "sign-in-required"} status
 * @property {number} agreementCount
 * @property {number} disagreementCount
 * @property {number} answeredCount
 * @property {number | null} percentage Null when there are no answers.
 */

/** @typedef {{viewer?: ElectionViewer, signal?: AbortSignal, limit?: number, cursor?: string | null}} ElectionRequestOptions */

/**
 * Create the UI-facing Elections client from a provider. Provider operations
 * may be backed by development fixtures or, after contract confirmation, by
 * the delivered service's HTTP API.
 *
 * @param {Object} operations
 * @returns {Object}
 */
export function createElectionFeedClient(operations) {
  const required = [
    "readRoster",
    "readPositions",
    "readPolicyCounts",
    "readAlignment",
    "saveResponse",
    "clearResponse",
  ];
  const missing = required.filter((name) => typeof operations?.[name] !== "function");
  if (missing.length > 0) {
    throw new TypeError(`Election data provider is missing operations: ${missing.join(", ")}`);
  }

  return Object.freeze({
    readRoster(scope, options = {}) {
      return operations.readRoster(scope, options);
    },
    readBuildStatus(scope, options = {}) {
      return typeof operations.readBuildStatus === "function"
        ? operations.readBuildStatus(scope, options)
        : Promise.resolve({ builds: [] });
    },
    readPositions(scope, options = {}) {
      return operations.readPositions(scope, options);
    },
    readPolicyCounts(scope, options = {}) {
      return operations.readPolicyCounts(scope, options);
    },
    readAlignment(scope, options = {}) {
      return operations.readAlignment(scope, options);
    },
    saveResponse(input, options = {}) {
      return operations.saveResponse(input, options);
    },
    clearResponse(input, options = {}) {
      return operations.clearResponse(input, options);
    },
  });
}
