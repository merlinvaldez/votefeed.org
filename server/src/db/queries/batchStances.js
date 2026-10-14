import db from "../client.js";
import { normalizeMemberPosition } from "../../utils/voteAlignment.js";

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const positive = value => Number.isSafeInteger(value) && value > 0;
const measureNames = { hr: "house-bill", s: "senate-bill", hres: "house-resolution",
  sres: "senate-resolution", hjres: "house-joint-resolution", sjres: "senate-joint-resolution",
  hconres: "house-concurrent-resolution", sconres: "senate-concurrent-resolution" };

export function validateBatchStanceRequest(body) {
  if (!body || !positive(body.bill_id) || ![null, "approve", "disapprove"].includes(body.stance) ||
      !Array.isArray(body.members) || body.members.length !== 2 ||
      body.members.some(member => !member || typeof member.rep_bioguide_id !== "string" ||
        !member.rep_bioguide_id.trim() || !positive(member.member_vote_id)) ||
      new Set(body.members.map(member => member.rep_bioguide_id)).size !== 2 ||
      new Set(body.members.map(member => member.member_vote_id)).size !== 2) {
    fail(400, "Two distinct member vote links and an explicit stance or null are required");
  }
}

// Explicit desired state makes retries idempotent. Serialize batches for the
// authenticated user, including the first insert when no interaction exists.
export async function saveBatchStances(userId, body, pool = db) {
  validateBatchStanceRequest(body);
  if (!positive(userId)) fail(401, "Unauthorized");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '10s'");
    const { rows: [user] } = await client.query(
      "SELECT id, state, district FROM users WHERE id = $1 FOR UPDATE", [userId]);
    if (!user) fail(401, "Unauthorized");
    const { rows } = await client.query(`SELECT m.*, b.id AS bill_id, b.legislation_url,
        to_char(m.voted_on AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') AS event_time
      FROM member_voting_record m
      JOIN bills b ON b.number = m.legislationnumber AND b.bill_type = m.legislation_type
      JOIN reps r ON r.bioguideid = m.member_id
      WHERE m.id = ANY($1::integer[]) AND b.id = $2
        AND m.voted_on IS NOT NULL AND isfinite(m.voted_on)
        AND r.is_current_member = true AND r.chamber = 'Senate' AND m.chamber = 'Senate'
        AND LOWER(BTRIM(r.state)) = LOWER(BTRIM($3))
      ORDER BY m.member_id FOR SHARE OF m, b, r`,
    [body.members.map(member => member.member_vote_id), body.bill_id, user.state]);
    if (rows.length !== 2 || body.members.some(member => !rows.some(row =>
      row.id === member.member_vote_id && row.member_id === member.rep_bioguide_id))) {
      fail(403, "Vote links must represent your current Senators and this bill");
    }
    for (const row of rows) {
      const measure = measureNames[row.legislation_type];
      const url = typeof row.legislation_url === "string" ? row.legislation_url : "";
      const official = measure && new RegExp(`^https://www[.]congress[.]gov/bill/${row.congress_number}(st|nd|rd|th)-congress/${measure}/${row.legislationnumber}(/|[?#]|$)`).test(url);
      if (![row.congress_number, row.session_number, row.roll_call_number, row.legislationnumber].every(positive) ||
          !official || !row.event_time || !normalizeMemberPosition(row.vote)) {
        fail(400, "Unsupported recorded vote or bill link");
      }
    }
    const fields = ["chamber", "congress_number", "session_number", "roll_call_number",
      "legislation_type", "legislationnumber", "vote", "event_time"];
    if (fields.some(field => rows[0][field] !== rows[1][field])) {
      fail(400, "Combined responses require the same event and exact recorded position");
    }
    const interactions = [];
    for (const vote of rows) {
      const { rows: [existing] } = await client.query(`SELECT * FROM interactions
        WHERE user_id = $1 AND bill_id = $2 AND rep_bioguide_id = $3 AND member_vote_id = $4
        ORDER BY id DESC LIMIT 1 FOR UPDATE`, [userId, body.bill_id, vote.member_id, vote.id]);
      let saved;
      if (existing) {
        ({ rows: [saved] } = await client.query(
          "UPDATE interactions SET stance = $2 WHERE id = $1 RETURNING *", [existing.id, body.stance]));
        if (existing.stance !== body.stance) await client.query(`UPDATE bill_comments
          SET call_script = NULL, message_template = NULL, updated_at = now()
          WHERE interaction_id = $1`, [existing.id]);
      } else {
        ({ rows: [saved] } = await client.query(`INSERT INTO interactions
          (user_id, bill_id, rep_bioguide_id, member_vote_id, stance)
          VALUES ($1,$2,$3,$4,$5) RETURNING *`, [userId, body.bill_id, vote.member_id, vote.id, body.stance]));
      }
      interactions.push(saved);
    }
    await client.query("COMMIT");
    return { interactions };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
