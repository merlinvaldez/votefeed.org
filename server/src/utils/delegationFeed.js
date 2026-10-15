const key = values => JSON.stringify(values);
const positive = value => Number.isSafeInteger(value) && value > 0;
const text = value => typeof value === "string" && value.trim().length > 0;
const eventKey = row => [row.chamber, row.congress_number, row.session_number, row.roll_call_number];
// PostgreSQL emits UTC with all six fractional digits; pg's Date loses micros.
const timestamp = row => row.voted_on_precise ?? new Date(row.voted_on).toISOString().replace(/(\.\d{3})Z$/, "$1000Z");

// Count complete display groups, including uncategorized cards in All.
// Preserve exact policy names so sidebar selections use the same equality.
export function filterAndCountFeedCards(cards, policyArea = null, chamber = "All Reps") {
  cards = chamber === "All Reps" ? cards : cards.filter(card => card.event.chamber === chamber);
  const counts = new Map();
  for (const card of cards) {
    const name = card.bill.policyArea;
    if (text(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const filtered = policyArea === null ? cards
    : cards.filter(card => card.bill.policyArea === policyArea);
  return {
    cards: filtered,
    policyAreas: [...counts].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([name, count]) => ({ name, count })),
    totalPolicyCount: cards.length,
    filteredCardCount: filtered.length,
  };
}

// Canonicalize actions before selecting the latest eligible action per measure.
export function selectDelegationVotes(rows) {
  const actions = new Map();
  const diagnostics = [];
  for (const row of rows) {
    const valid = [row.congress_number, row.session_number, row.roll_call_number,
      row.member_vote_id, row.bill?.id, row.bill?.number].every(positive) &&
      ["House", "Senate"].includes(row.chamber) && text(row.member_id) &&
      text(row.vote) && text(row.bill?.type) &&
      row.bill.congress === row.congress_number &&
      row.member?.bioguideId === row.member_id && row.member.chamber === row.chamber &&
      row.member.memberVoteId === row.member_vote_id &&
      Number.isFinite(new Date(row.voted_on ?? "").getTime());
    if (!valid) {
      diagnostics.push({ code: "INVALID_VOTE_RECORDS", memberVoteId: row.member_vote_id });
      continue;
    }
    const action = key([row.member_id, ...eventKey(row)]);
    const records = actions.get(action) ?? [];
    records.push(row);
    actions.set(action, records);
  }
  const latest = new Map();
  for (const records of actions.values()) {
    const signatures = new Set(records.map(row => key([
      row.bill.id, row.bill.type, row.bill.number, row.vote, timestamp(row),
    ])));
    if (signatures.size !== 1) {
      diagnostics.push({ code: "CONFLICTING_VOTE_RECORDS", memberVoteIds: records.map(row => row.member_vote_id) });
      continue;
    }
    const row = records.reduce((a, b) => a.member_vote_id > b.member_vote_id ? a : b);
    if (records.length > 1) diagnostics.push({ code: "DUPLICATE_VOTE_RECORDS", memberVoteId: row.member_vote_id });
    const measure = key([row.member_id, row.chamber, row.congress_number, row.bill.id]);
    const previous = latest.get(measure);
    const rank = value => [timestamp(value), value.session_number,
      value.roll_call_number, value.member_vote_id];
    const newer = !previous || rank(row).some((value, i) =>
      value > rank(previous)[i] && rank(row).slice(0, i).every((v, j) => v === rank(previous)[j]));
    if (newer) latest.set(measure, row);
  }
  return { votes: [...latest.values()], diagnostics };
}

export function groupDelegationVotes(votes, { policyArea = null } = {}) {
  const groups = new Map();
  const diagnostics = [];
  for (const row of votes) {
    if (policyArea !== null && row.bill.policyArea !== policyArea) continue;
    const id = key(["legislative-feed-card-v1", ...eventKey(row), row.bill.id,
      row.vote, row.chamber === "House" ? row.member_id : null]);
    const group = groups.get(id) ?? [];
    group.push(row);
    groups.set(id, group);
  }
  const cards = [];
  for (const [id, records] of groups) {
    const dates = new Set(records.map(timestamp));
    if (dates.size !== 1) {
      diagnostics.push({ code: "CONFLICTING_VOTE_RECORDS", memberVoteIds: records.map(row => row.member_vote_id) });
      continue;
    }
    const row = records[0];
    cards.push({ id,
      event: { chamber: row.chamber, congress: row.congress_number,
        session: row.session_number, rollCall: row.roll_call_number },
      position: row.vote, votedOn: timestamp(row),
      bill: row.bill, summary: row.summary,
      members: [...new Map(records.map(record => [record.member_id, record.member])).values()]
        .sort((a, b) => a.bioguideId < b.bioguideId ? -1 : a.bioguideId > b.bioguideId ? 1 : 0),
    });
  }
  return { cards, diagnostics };
}
