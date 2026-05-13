import db from "../client.js";

export async function getCommentByInteractionId(interactionId) {
  const sql = `SELECT * FROM bill_comments WHERE interaction_id = $1`;
  const {
    rows: [comment],
  } = await db.query(sql, [interactionId]);
  return comment ?? null;
}

export async function upsertDraftComment({
  interactionId,
  userId,
  billId,
  repBioguideId,
  draftText,
}) {
  const sql = `
    INSERT INTO bill_comments (
      interaction_id,
      user_id,
      bill_id,
      rep_bioguide_id,
      draft_text,
      moderation_status,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, 'draft', now())
    ON CONFLICT (interaction_id) DO UPDATE SET
      draft_text = EXCLUDED.draft_text,
      moderation_status = 'draft',
      moderation_reason = NULL,
      moderation_categories = NULL,
      updated_at = now()
    RETURNING *
  `;
  const {
    rows: [comment],
  } = await db.query(sql, [
    interactionId,
    userId,
    billId,
    repBioguideId,
    draftText,
  ]);
  return comment;
}

export async function applyCommentModerationResult({
  interactionId,
  status,
  moderationReason,
  moderationCategories,
}) {
  const sql = `
    UPDATE bill_comments
    SET moderation_status = $2,
        moderation_reason = $3,
        moderation_categories = $4,
        approved_text = CASE
          WHEN $2 = 'approved' THEN draft_text
          ELSE approved_text
        END,
        last_submitted_at = now(),
        last_moderated_at = now(),
        updated_at = now()
    WHERE interaction_id = $1
    RETURNING *
  `;
  const {
    rows: [comment],
  } = await db.query(sql, [
    interactionId,
    status,
    moderationReason,
    moderationCategories,
  ]);
  return comment ?? null;
}
