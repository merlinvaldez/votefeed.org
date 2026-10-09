import db from "../client.js";
import { normalizeMemberPosition } from "../../utils/voteAlignment.js";

export async function findMemberVoteForBill(memberId, billId, runner = db) {
  const { rows: [vote] } = await runner.query(`SELECT
    m.id AS member_vote_id, m.member_id, m.chamber, m.congress_number,
    m.session_number, m.roll_call_number, m.voted_on, m.vote,
    b.id AS bill_id, b.number AS legislationnumber, b.bill_type AS legislation_type
    FROM member_voting_record m
    JOIN bills b ON b.number = m.legislationnumber AND b.bill_type = m.legislation_type
    WHERE m.member_id = $1 AND b.id = $2 AND m.voted_on IS NOT NULL
    ORDER BY m.voted_on DESC, m.session_number DESC, m.roll_call_number DESC, m.id DESC
    LIMIT 1`, [memberId, billId]);
  return vote ?? null;
}

export async function validateStanceVoteLink({ billId, memberId, memberVoteId, existingVoteId }, runner = db) {
  if (!Number.isSafeInteger(memberVoteId) || memberVoteId <= 0) {
    return "A recorded member vote is required";
  }
  if (existingVoteId != null && existingVoteId !== memberVoteId) {
    return "An answer cannot be moved to a different voting event";
  }
  const { rows: [vote] } = await runner.query(`SELECT m.vote
    FROM member_voting_record m
    JOIN bills b ON b.number = m.legislationnumber AND b.bill_type = m.legislation_type
    WHERE m.id = $1 AND m.member_id = $2 AND b.id = $3`, [memberVoteId, memberId, billId]);
  if (!vote) return "Recorded vote does not match the bill and representative";
  return normalizeMemberPosition(vote.vote) ? null : "This member position cannot be compared";
}
