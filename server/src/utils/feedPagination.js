import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

const VERSION = 1;
const LIFETIME = 30 * 60 * 1000;
const serialize = value => JSON.stringify(value);
const error = (status, code, message) => Object.assign(new Error(message), { status, code });
const invalid = () => error(400, "INVALID_FEED_CURSOR", "Invalid feed cursor or page options");
const restart = () => error(409, "FEED_RESTART_REQUIRED", "Feed changed or expired. Refresh to restart.");
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const sortFeedCards = cards => [...cards].sort((a, b) =>
  compare(b.votedOn, a.votedOn) || compare(a.id, b.id));
const signature = (body, secret) => createHmac("sha256", secret).update(body).digest("base64url");

function encode(snapshot, index) {
  const last = snapshot.payload.cards[index - 1];
  const body = Buffer.from(serialize({ v: VERSION, snapshotId: snapshot.id, index,
    last: [last.votedOn, last.id] })).toString("base64url");
  return `${body}.${signature(body, snapshot.signingKey)}`;
}

// Scope is constructed by the server, never copied from decoded cursor claims.
export async function paginateFeed({ scope, limit = 5, policyArea = null, cursor = null,
  offset, store, load, validateSnapshot = async () => true, now = Date.now() }) {
  if (offset !== undefined || !Number.isInteger(Number(limit)) || Number(limit) < 1 ||
      Number(limit) > 50 || !["number", "string"].includes(typeof limit) ||
      (typeof limit === "string" && !/^\d+$/.test(limit)) ||
      (policyArea !== null && (typeof policyArea !== "string" || !policyArea.trim())) ||
      !scope || !textIdentity(scope.viewer)) throw invalid();
  limit = Number(limit);
  let snapshot;
  let index = 0;
  if (cursor !== null) {
    if (typeof cursor !== "string" || cursor.length > 4096 || !/^[\w-]+\.[\w-]+$/.test(cursor)) throw invalid();
    const [body, sig] = cursor.split(".");
    let claims;
    try { claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { throw invalid(); }
    if (claims?.v !== VERSION || typeof claims.snapshotId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(claims.snapshotId) ||
        !Number.isSafeInteger(claims.index) || claims.index < 1) throw invalid();
    snapshot = await store.get(claims.snapshotId);
    if (!snapshot) throw restart();
    const expected = signature(body, snapshot.signingKey);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw invalid();
    const payload = snapshot.payload;
    if (payload.scope.viewer !== scope.viewer) {
      throw error(403, "FEED_SCOPE_FORBIDDEN", "Cursor belongs to another viewer");
    }
    if (snapshot.expiresAt <= now || !isDeepStrictEqual(payload.scope, scope)) throw restart();
    if (payload.limit !== limit || payload.policyArea !== policyArea) throw invalid();
    index = claims.index;
    const last = payload.cards[index - 1];
    if (!last || index % limit !== 0 || serialize(claims.last) !== serialize([last.votedOn, last.id])) throw invalid();
    if (!await validateSnapshot(snapshot)) throw restart();
  } else {
    const result = await load();
    snapshot = { id: randomUUID(), signingKey: randomBytes(32).toString("hex"),
      expiresAt: now + LIFETIME, payload: JSON.parse(serialize({
        scope, limit, policyArea, result, cards: sortFeedCards(result.cards),
      })) };
    await store.save(snapshot);
  }
  const cards = snapshot.payload.cards.slice(index, index + limit);
  const nextIndex = index + cards.length;
  const hasMore = nextIndex < snapshot.payload.cards.length;
  const { cards: ignoredCards, votes: ignoredVotes, diagnostics: ignoredDiagnostics, ...metadata } = snapshot.payload.result;
  return { ...metadata, cards,
    emptyReason: cursor === null && cards.length === 0 ? metadata.emptyReason ?? null : null,
    selectedPolicyArea: policyArea,
    page: { limit, hasMore, nextCursor: hasMore ? encode(snapshot, nextIndex) : null,
      snapshotId: snapshot.id },
  };
}

function textIdentity(value) {
  return typeof value === "string" && value.length > 0;
}
