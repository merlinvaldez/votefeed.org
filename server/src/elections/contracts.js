import { createHash } from "node:crypto";

// Versioned release scope, never inferred from today's date.
export const STATES = Object.freeze("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));
export const RELEASE_SCOPE = Object.freeze({ cycle: 2026, stage: "general", contestType: "regular", offices: Object.freeze(["house", "senate"]), states: STATES, geography: "2026-election" });
export const ELECTION_GEOGRAPHY_SOURCE = 'https://www.census.gov/programs-surveys/decennial-census/about/rdo/congressional-districts.html';
export const ELECTION_GEOGRAPHY_VERSION = 'ACS2026_Current:120th';
export const TOPICS = Object.freeze(["economy", "healthcare", "housing", "education", "environment", "immigration", "civil-rights", "public-safety", "foreign-policy", "government", "other"]);
export const AVAILABILITY = Object.freeze(["available", "no-race", "coverage-unknown", "geography-unverified", "site-missing", "site-unverified", "pending", "no-positions", "crawl-failed", "extraction-failed"]);

const fail = message => { throw new TypeError(message); };
const required = (value, name) => typeof value === "string" && value.trim() ? value : fail(`Invalid ${name}`);
export function normalizeState(value) {
  const state = required(value, "state").trim().toUpperCase();
  return STATES.includes(state) ? state : fail("Expected a two-letter US state code");
}
export function normalizeDistrict(value) {
  if (typeof value === "string" && ["AL", "AT-LARGE"].includes(value.trim().toUpperCase())) return 0;
  if (!(typeof value === "number" || typeof value === "string" && /^\d{1,2}$/.test(value))) fail("Invalid district");
  const district = Number(value);
  return Number.isInteger(district) && district >= 0 && district <= 99 ? district : fail("Invalid district");
}
export function normalizeRace(input) {
  const { office, electionDate, stage, contestType } = input;
  if (!["house", "senate"].includes(office) || !["general", "primary", "runoff"].includes(stage) || !["regular", "special"].includes(contestType)) fail("Invalid race classification");
  if (typeof electionDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(electionDate) || !Number.isFinite(Date.parse(electionDate)) || new Date(electionDate).toISOString().slice(0, 10) !== electionDate) fail("Invalid election date");
  const state = normalizeState(input.state);
  if (office === "house" && input.senateSeat != null || office === "senate" && input.district != null) fail("Mixed seat types");
  const district = office === "house" ? normalizeDistrict(input.district) : null;
  const senateSeat = office === "senate" ? input.senateSeat : null;
  if (office === "senate" && ![1, 2, 3].includes(senateSeat)) fail("Senate seat must be its numeric class, never senior/junior");
  return { office, state, district, senateSeat, electionDate, stage, contestType };
}
export function raceKey(input) {
  const r = normalizeRace(input);
  return JSON.stringify([r.office, r.state, r.district, r.senateSeat, r.electionDate, r.stage, r.contestType]);
}
export function isReleaseRace(input) {
  const r = normalizeRace(input);
  return r.electionDate.startsWith(`${RELEASE_SCOPE.cycle}-`) && r.stage === RELEASE_SCOPE.stage && r.contestType === RELEASE_SCOPE.contestType;
}
// Source systems must include jurisdiction and entity kind (e.g. state:NY:candidate).
export function sourceIdentityKey({ system, id }) {
  return JSON.stringify([required(system, "source system"), required(id, "source identifier")]);
}
export function positionVersionKey({ candidacyId, claimId, claimText }) {
  // claimId is an explicitly reconciled lineage, not a topic or model array index.
  return createHash("sha256").update(JSON.stringify([required(candidacyId, "candidacyId"), required(claimId, "claimId"), required(claimText, "claimText")])).digest("hex");
}
export function validateExtractionItem(item, snapshot) {
  const errors = [];
  if (item.candidacyId !== snapshot.candidacyId || item.snapshotId !== snapshot.id) errors.push("source-association");
  if (!TOPICS.includes(item.topic)) errors.push("topic");
  for (const field of ["claimText", "summary", "excerpt"]) {
    if (typeof item[field] !== "string" || !item[field].trim()) errors.push(field);
  }
  if (typeof item.summary === "string" && item.summary.length > 500) errors.push("summary-length");
  if (typeof snapshot.text !== "string" || typeof item.excerpt !== "string" || !snapshot.text.includes(item.excerpt)) errors.push("excerpt-missing");
  // Structural success alone never authorizes publication.
  return { outcome: errors.length ? "invalid" : "requires-semantic-validation", errors };
}
