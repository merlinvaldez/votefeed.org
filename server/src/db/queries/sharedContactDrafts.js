import db from "../client.js";
import { matchesSummaryMeasure } from "../../utils/summaryMeasure.js";

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

export function validateSharedContactContext(rows, interactionIds, sourceInteractionId) {
  if (rows.length !== 2 || !interactionIds.includes(sourceInteractionId) ||
      interactionIds.some(id => !rows.some(row => row.id === id)) ||
      new Set(rows.map(row => row.rep_bioguide_id)).size !== 2) {
    fail(403, "Contact actions must belong to your two current Senators");
  }
  const same = ["bill_id", "chamber", "congress_number", "session_number", "roll_call_number", "vote", "event_time", "bill_type", "number"];
  if (same.some(field => rows[0][field] !== rows[1][field]) || rows.some(row =>
    row.chamber !== "Senate" || !["approve", "disapprove"].includes(row.stance) ||
    ![row.congress_number, row.session_number, row.roll_call_number, row.member_vote_id].every(value => Number.isSafeInteger(value) && value > 0) ||
    !row.event_time || !row.vote?.trim() || !matchesSummaryMeasure(row, row.congress_number, row.bill_type, row.number))) {
    fail(409, "Both responses must refer to the same recorded Senate action. Reopen it from the feed.");
  }
  if (!rows[0].approved_text?.trim()) fail(409, "Approved comment required");
}

export async function sharedCommentContactDrafts({ userId, sourceInteractionId, interactionIds, generateDrafts }, runner = db) {
  if (!Number.isSafeInteger(sourceInteractionId) || sourceInteractionId <= 0 ||
      !Array.isArray(interactionIds) || interactionIds.length !== 2 ||
      !interactionIds.every(id => Number.isSafeInteger(id) && id > 0) || new Set(interactionIds).size !== 2) {
    fail(400, "Two distinct interaction IDs are required");
  }
  const read = async () => {
    const { rows } = await runner.query(`SELECT i.id, i.rep_bioguide_id, i.member_vote_id, i.bill_id, i.stance,
      m.chamber, m.congress_number, m.session_number, m.roll_call_number, m.vote,
      to_char(m.voted_on AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS event_time,
      b.bill_type, b.number, b.legislation_url,
      r.full_name, r.chamber AS rep_chamber,
      u.first_name, u.last_name, u.state, u.district,
      c.approved_text, c.updated_at::text AS comment_version
      FROM interactions i JOIN users u ON u.id = i.user_id
      JOIN member_voting_record m ON m.id = i.member_vote_id AND m.member_id = i.rep_bioguide_id
      JOIN bills b ON b.id = i.bill_id AND b.bill_type = m.legislation_type AND b.number = m.legislationnumber
      JOIN reps r ON r.bioguideid = i.rep_bioguide_id AND r.is_current_member = true
        AND r.chamber = 'Senate' AND LOWER(BTRIM(r.state)) = LOWER(BTRIM(u.state))
      JOIN bill_comments c ON c.interaction_id = $3 AND c.user_id = i.user_id AND c.bill_id = i.bill_id
      WHERE i.user_id = $1 AND i.id = ANY($2::integer[]) AND isfinite(m.voted_on) ORDER BY i.id`, [userId, interactionIds, sourceInteractionId]);
    return rows;
  };
  const rows = await read();
  validateSharedContactContext(rows, interactionIds, sourceInteractionId);
  // One discussion comment supplies both personalized guides. Do not copy it
  // into a second public comment or reuse a different recipient's cached text.
  const members = await Promise.all(rows.map(async row => {
    const drafts = await generateDrafts({ constituentName: [row.first_name, row.last_name].filter(Boolean).join(" "),
      userState: row.state, userDistrict: row.district, billType: row.bill_type, billNumber: row.number,
      repFullName: row.full_name, repChamber: row.rep_chamber, stance: row.stance, approvedCommentText: row.approved_text });
    if (!drafts?.callScript?.trim() || !drafts?.messageTemplate?.trim()) fail(503, "Contact drafts are incomplete. Please retry.");
    return { memberId: row.rep_bioguide_id, interactionId: row.id, ...drafts };
  }));
  if (JSON.stringify(await read()) !== JSON.stringify(rows)) fail(409, "Comment or responses changed. Please retry contact drafts.");
  return { members };
}
