import db from "../client.js";
import { findCurrentDelegation } from "./delegation.js";
import { selectDelegationVotes, groupDelegationVotes, filterAndCountFeedCards } from "../../utils/delegationFeed.js";

// Read the entire delegation together. Paging and card grouping belong after
// this selection, never on independently paginated member lists.
async function findDelegationVoteCandidates(delegation, runner = db) {
  const members = [delegation.houseMember, ...delegation.senators].filter(Boolean);
  const houseIds = members.filter(member => member.chamber === "House of Representatives")
    .map(member => member.bioguideid);
  const senateIds = members.filter(member => member.chamber === "Senate")
    .map(member => member.bioguideid);
  if (!houseIds.length && !senateIds.length) return [];
  const { rows } = await runner.query(`WITH eligible_votes AS (
    SELECT m.*, b.id AS bill_id, b.title AS bill_title,
      b.policy_area, b.legislation_url, b.summary, b.aisummary
    FROM member_voting_record m
    JOIN bills b ON b.number = m.legislationnumber
      AND b.bill_type = m.legislation_type
      -- bills has no persisted Congress. Require the official measure link
      -- to establish it instead of assuming all rows belong to Congress 119.
      AND b.legislation_url ~ (
        '^https://www[.]congress[.]gov/bill/' || m.congress_number ||
        '(st|nd|rd|th)-congress/' || CASE m.legislation_type
          WHEN 'hr' THEN 'house-bill' WHEN 's' THEN 'senate-bill'
          WHEN 'hjres' THEN 'house-joint-resolution'
          WHEN 'sjres' THEN 'senate-joint-resolution'
          WHEN 'hconres' THEN 'house-concurrent-resolution'
          WHEN 'sconres' THEN 'senate-concurrent-resolution'
          WHEN 'hres' THEN 'house-resolution'
          WHEN 'sres' THEN 'senate-resolution'
          ELSE NULL END || '/' || m.legislationnumber ||
        '(/|[?#]|$)')
    WHERE ((m.chamber = 'House' AND m.member_id = ANY($1::text[]))
      OR (m.chamber = 'Senate' AND m.member_id = ANY($2::text[])))
      AND m.congress_number > 0 AND m.session_number > 0
      AND m.roll_call_number > 0 AND m.legislationnumber > 0
      AND m.id > 0 AND b.id > 0
      AND m.voted_on IS NOT NULL AND isfinite(m.voted_on)
      AND BTRIM(m.vote) <> ''
  )
  SELECT id AS member_vote_id, member_id, bill_id, chamber, congress_number,
    session_number, roll_call_number, legislation_type, legislationnumber,
    voted_on, to_char(voted_on AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS voted_on_precise,
    vote, bill_title, policy_area, legislation_url, summary, aisummary
  FROM eligible_votes
  ORDER BY voted_on DESC, congress_number DESC, session_number DESC,
    roll_call_number DESC, chamber ASC, member_id ASC, bill_id ASC, member_vote_id DESC`,
  [[...new Set(houseIds)], [...new Set(senateIds)]]);
  const roster = new Map(members.map(member => [member.bioguideid, member]));
  return rows.map(row => {
    const member = roster.get(row.member_id);
    const chamber = member?.chamber === "House of Representatives" ? "House" : member?.chamber;
    if (!member || chamber !== row.chamber) {
      throw new Error("Delegation vote does not match its roster member/chamber");
    }
    return {
      ...row,
      member: {
        bioguideId: row.member_id,
        memberVoteId: row.member_vote_id,
        name: member.full_name?.trim() || row.member_id,
        chamber,
        portrait: member.image_url ?? null,
      },
      bill: {
        id: row.bill_id,
        // The join verified Congress against the official measure URL.
        congress: row.congress_number,
        type: row.legislation_type,
        number: row.legislationnumber,
        title: row.bill_title ?? null,
        policyArea: row.policy_area ?? null,
        legislationUrl: row.legislation_url ?? null,
      },
      summary: {
        officialHtml: row.summary || null,
        simplifiedText: row.aisummary || null,
      },
    };
  });
}

export async function findLatestDelegationVotes(delegation, runner = db) {
  const rows = await findDelegationVoteCandidates(delegation, runner);
  return selectDelegationVotes(rows).votes;
}

// Shared entry point: callers supply either req.user's saved state/district or
// the guest address lookup's state/district. No user-supplied member IDs.
export async function readDelegationFeedRecords(location, { runner = db, policyArea = null, resolvedDelegation } = {}) {
  const delegation = resolvedDelegation ?? await findCurrentDelegation(location, runner);
  const candidates = await findDelegationVoteCandidates(delegation, runner);
  const { votes, diagnostics } = selectDelegationVotes(candidates);
  const grouped = groupDelegationVotes(votes);
  const counted = filterAndCountFeedCards(grouped.cards, policyArea);
  const allDiagnostics = [...diagnostics, ...grouped.diagnostics];
  for (const diagnostic of allDiagnostics) {
    console.warn("Delegation feed record diagnostic", diagnostic);
  }
  const warnings = [...new Set(allDiagnostics.filter(item => item.code !== "DUPLICATE_VOTE_RECORDS")
    .map(item => item.code))].map(code => ({ code,
    message: code === "INVALID_VOTE_RECORDS" ? "Some invalid vote records were excluded."
      : "Some conflicting vote records were excluded.",
  }));
  const hasMembers = Boolean(delegation.houseMember) || delegation.senators.length > 0;
  const emptyReason = counted.cards.length ? null
    : !hasMembers ? "NO_DELEGATION"
    : !grouped.cards.length && warnings.length ? "INVALID_VOTE_DATA"
    : !grouped.cards.length ? "NO_ELIGIBLE_VOTES"
    : "NO_POLICY_MATCHES";
  return { delegation, votes, ...counted, diagnostics: allDiagnostics,
    warnings, dataStatus: warnings.length ? "partial" : "complete", emptyReason,
    retry: warnings.length ? { mode: "refresh", message: "Refresh the feed to retry excluded records." } : null };
}
