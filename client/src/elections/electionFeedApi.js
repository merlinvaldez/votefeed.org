import { API_BASE } from "../constants.js";
import { createElectionFeedClient } from "./electionFeedClient.js";

function apiError(payload, status) {
  const error = new Error(payload?.error || "Elections could not be loaded. Please retry.");
  error.status = status;
  error.code = payload?.code ?? "ELECTIONS_REQUEST_FAILED";
  error.retryable = Boolean(payload?.retryable);
  error.restartFromFirstPage = payload?.retry?.mode === "refresh";
  return error;
}

/**
 * Real HTTP adapter for the server Elections contract. Guest addresses are
 * sent only in JSON bodies and are resolved by the server; signed-in requests
 * use the server's saved derived geography. The raw address is never stored.
 */
export function createElectionHttpClient({
  viewer,
  address = null,
  authFetch,
  apiBase = API_BASE,
} = {}) {
  if (!["guest", "signed-in"].includes(viewer)) throw new TypeError("Election HTTP client requires a viewer.");
  if (viewer === "signed-in" && typeof authFetch !== "function") throw new TypeError("Signed-in Elections requests require authFetch.");

  async function request(path, body, { signal, method = "POST" } = {}) {
    if (viewer === "guest" && !address) {
      const error = new Error("Enter your address to load matching election races.");
      error.code = "ELECTION_GEOGRAPHY_UNAVAILABLE";
      throw error;
    }
    const send = viewer === "signed-in" ? authFetch : fetch;
    const response = await send(`${apiBase}/elections/${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(method === "POST" || method === "PUT" ? { body: JSON.stringify({
        ...(viewer === "guest" ? { address } : {}),
        ...body,
      }) } : {}),
      signal,
    });
    let payload = null;
    try { payload = await response.json(); } catch { /* use a stable public error below */ }
    if (!response.ok) throw apiError(payload, response.status);
    return payload ?? {};
  }

  return Object.freeze({
    ...createElectionFeedClient({
      readRoster(scope, options = {}) {
        return request("roster", { chamber: scope.chamber ?? "all" }, options);
      },
      readBuildStatus(scope, options = {}) {
        return request("build-status", { chamber: scope.chamber ?? "all" }, options);
      },
      readPositions(scope, options = {}) {
        return request("feed", {
          chamber: scope.chamber ?? "all",
          candidacyId: scope.candidacyId ?? null,
          policyArea: scope.policyArea ?? null,
          limit: options.limit ?? 20,
          cursor: options.cursor ?? null,
        }, options);
      },
      readPolicyCounts(scope, options = {}) {
        return request("policy-counts", {
          chamber: scope.chamber ?? "all",
          candidacyId: scope.candidacyId ?? null,
        }, options);
      },
      readAlignment(scope, options = {}) {
        if (viewer === "guest") return Promise.resolve({
          status: "sign-in-required", agreementCount: 0, disagreementCount: 0, answeredCount: 0, percentage: null,
        });
        return request("alignment", {
          chamber: scope.chamber ?? "all",
          candidacyId: scope.candidacyId ?? null,
          policyArea: scope.policyArea ?? null,
        }, options);
      },
      saveResponse(input, options = {}) {
        if (viewer === "guest") return Promise.resolve({ status: "sign-in-required", response: null });
        return request(`responses/${encodeURIComponent(input.positionVersionId)}`, {
          stance: input.stance,
        }, { ...options, method: "PUT" });
      },
      clearResponse(input, options = {}) {
        if (viewer === "guest") return Promise.resolve({ status: "sign-in-required", response: null });
        return request(`responses/${encodeURIComponent(input.positionVersionId)}`, {}, { ...options, method: "DELETE" });
      },
    }),
    dataMode: "service",
  });
}
