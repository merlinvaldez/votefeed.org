import { readDelegationFeedPage } from "../db/queries/delegationFeedPage.js";

const invalid = message => Object.assign(new Error(message), {
  status: 400, code: "INVALID_FEED_CURSOR",
});

export function parseFeedPageOptions(query) {
  // Reject repeated/nested query values rather than coercing arrays or objects.
  for (const field of ["limit", "policyArea", "cursor"]) {
    if (query[field] !== undefined && typeof query[field] !== "string") {
      throw invalid(`Invalid ${field}`);
    }
  }
  const limit = query.limit === undefined ? 5 : Number(query.limit);
  if (query.offset !== undefined || !Number.isInteger(limit) || limit < 1 || limit > 50 ||
      (query.limit !== undefined && !/^\d+$/.test(query.limit))) {
    throw invalid("Use a limit from 1 to 50 and cursor pagination; offsets are unsupported");
  }
  const policyArea = query.policyArea ?? null;
  if (policyArea !== null && !policyArea.trim()) throw invalid("Invalid policyArea");
  const cursor = query.cursor ?? null;
  if (cursor !== null && (cursor.length > 4096 || !/^[\w-]+\.[\w-]+$/.test(cursor))) {
    throw invalid("Invalid feed cursor");
  }
  return { limit, policyArea, cursor };
}

export function delegationFeedHandler({ authenticated = false, readPage = readDelegationFeedPage } = {}) {
  return async (req, res) => {
    try {
      const options = parseFeedPageOptions(req.query);
      const location = authenticated ? req.user
        : { state: req.query.state, district: req.query.district };
      return res.json(await readPage(location, {
        ...options, userId: authenticated ? req.user.id : null,
      }));
    } catch (err) {
      if (err.code === "INVALID_DELEGATION_LOCATION") {
        return res.status(400).json({ code: err.code, error: err.message });
      }
      if (["INVALID_FEED_CURSOR", "FEED_SCOPE_FORBIDDEN", "FEED_RESTART_REQUIRED"].includes(err.code)) {
        const restart = err.code === "FEED_RESTART_REQUIRED";
        return res.status(err.status).json({ code: err.code, error: err.message,
          retryable: restart, retry: restart ? { mode: "refresh" } : null });
      }
      console.error("Delegation feed read failed", err);
      // Never expose database messages or replace a failed read with empty cards.
      // A continuation retry uses the same cursor and therefore the same snapshot.
      return res.status(503).json({ code: "FEED_READ_FAILED",
        error: "The feed could not be loaded. Please retry.", retryable: true,
        retry: { mode: "same-request" } });
    }
  };
}
