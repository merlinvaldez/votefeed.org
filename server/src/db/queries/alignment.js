import db from "../client.js";
import { compareStanceWithMemberVote } from "../../utils/voteAlignment.js";
import { findRepByDistrict, findCurrentMembersByStateAndChamber } from "./reps.js";

export const ALIGNMENT_CHAMBERS = ["All Reps", "House", "Senate"];

export function selectComparableAlignmentVotes(rows) {
  const latest = new Map();
  for (const row of rows) {
    const vote = row.memberVote;
    if (!vote || !vote.member_id || !["House", "Senate"].includes(vote.chamber) ||
        ![vote.congress_number, vote.session_number, vote.roll_call_number]
          .every(value => Number.isInteger(value) && value > 0)) continue;
    const key = JSON.stringify([
      row.stance.user_id, vote.member_id, vote.chamber,
      vote.congress_number, vote.session_number, vote.roll_call_number,
    ]);
    const previous = latest.get(key);
    if (!previous || row.stance.id > previous.stance.id) latest.set(key, row);
  }

  return [...latest.values()].flatMap(({ stance, memberVote }) => {
    const comparison = compareStanceWithMemberVote(stance, memberVote);
    return comparison ? [{
      interactionId: stance.id,
      memberVoteId: memberVote.id,
      memberId: memberVote.member_id,
      billId: memberVote.bill_id,
      chamber: memberVote.chamber,
      congressNumber: memberVote.congress_number,
      sessionNumber: memberVote.session_number,
      rollCallNumber: memberVote.roll_call_number,
      ...comparison,
    }] : [];
  });
}

export async function getComparableAlignmentVotes(
  userId, memberIds, { policyArea = null, runner = db } = {},
) {
  if (!memberIds.length) return [];
  // Exact event links preserve the question answered and its Congress scope.
  const { rows } = await runner.query(`SELECT
    to_jsonb(interactions) AS stance,
    to_jsonb(member_voting_record) || jsonb_build_object('bill_id', bills.id)
      AS "memberVote"
    FROM interactions
    JOIN member_voting_record ON member_voting_record.id = interactions.member_vote_id
    JOIN bills ON bills.id = interactions.bill_id
      AND bills.number = member_voting_record.legislationNumber
      AND bills.bill_type = member_voting_record.legislation_type
    WHERE interactions.user_id = $1
      AND member_voting_record.member_id = ANY($2::text[])
      AND interactions.rep_bioguide_id = member_voting_record.member_id
      AND ($3::text IS NULL OR bills.policy_area = $3)`,
  [userId, [...new Set(memberIds)], policyArea]);

  return selectComparableAlignmentVotes(rows);
}

export function summarizeAlignment(members, comparisons) {
  const uniqueMembers = [...new Map(members.map(member => [member.memberId, member])).values()];
  const memberSummaries = uniqueMembers.map(member => {
    const votes = comparisons.filter(vote => vote.memberId === member.memberId && vote.chamber === member.chamber);
    const comparableCount = votes.length;
    const agreementCount = votes.filter(vote => vote.agrees).length;
    return {
      ...member,
      agreementCount,
      comparableCount,
      percent: comparableCount ? Math.round(100 * agreementCount / comparableCount) : null,
      hasData: comparableCount > 0,
    };
  });
  const eligible = memberSummaries.filter(member => member.hasData);
  const agreementCount = memberSummaries.reduce((sum, member) => sum + member.agreementCount, 0);
  const comparableCount = memberSummaries.reduce((sum, member) => sum + member.comparableCount, 0);
  const percent = eligible.length ? Math.round(100 * eligible.reduce(
    (sum, member) => sum + member.agreementCount / member.comparableCount, 0,
  ) / eligible.length) : null;
  return {
    agreementCount,
    comparableCount,
    // Retain existing consumers' count fields during the card transition.
    approveCount: agreementCount,
    totalCount: comparableCount,
    disapproveCount: comparableCount - agreementCount,
    percent,
    hasData: eligible.length > 0,
    emptyMessage: eligible.length ? null : "No alignment data yet",
    memberCount: memberSummaries.length,
    membersWithData: eligible.length,
    members: memberSummaries,
  };
}

export async function getAlignmentByUserAndMembers(userId, members, options = {}) {
  const comparisons = await getComparableAlignmentVotes(userId, members.map(member => member.memberId), options);
  return summarizeAlignment(members, comparisons);
}

export async function getDelegationAlignment(
  user, { policyArea = null, chamber = "House", houseMember, runner = db } = {},
) {
  if (!ALIGNMENT_CHAMBERS.includes(chamber)) throw new Error("Invalid alignment chamber");
  const [house, senators] = await Promise.all([
    houseMember !== undefined ? houseMember : user.state && user.district != null
      ? findRepByDistrict(user.state, user.district, runner) : null,
    user.state ? findCurrentMembersByStateAndChamber(user.state, "Senate", runner) : [],
  ]);
  const members = [house, ...senators].filter(Boolean).map(member => ({
    memberId: member.bioguideid,
    name: member.full_name,
    chamber: member.chamber === "Senate" ? "Senate" : "House",
  }));
  const comparisons = await getComparableAlignmentVotes(user.id, members.map(member => member.memberId), { policyArea, runner });
  const byChamber = Object.fromEntries(ALIGNMENT_CHAMBERS.map(tab => [tab, summarizeAlignment(
    members.filter(member => tab === "All Reps" || member.chamber === tab), comparisons,
  )]));
  return { ...byChamber[chamber], selectedChamber: chamber, policyArea, byChamber };
}
