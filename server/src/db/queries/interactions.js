import db from "../client.js";

export async function addStance(userId, billId, rep_bioguide_id, stance) {
  const sql = `INSERT INTO interactions (user_id, bill_id, rep_bioguide_id, stance)
  VALUES ($1,$2,$3,$4)
  RETURNING *`;
  const {
    rows: [addedStance],
  } = await db.query(sql, [userId, billId, rep_bioguide_id, stance]);
  return addedStance;
}

export async function updateStance(interactionId, newStance) {
  const sql = `UPDATE interactions 
  SET stance =$2 
  WHERE id = $1
  RETURNING *`;
  const {
    rows: [updatedStance],
  } = await db.query(sql, [interactionId, newStance]);
  return updatedStance;
}

export async function removeStanceAndComment(interactionId) {
  const sql = `DELETE from interactions where id=$1 RETURNING *`;
  const {
    rows: [deleted],
  } = await db.query(sql, [interactionId]);
  return deleted;
}

export async function updateComment(interactionId, comment) {
  const sql = `UPDATE interactions
  SET user_comment= $2
  WHERE id=$1 
  RETURNING *`;
  const {
    rows: [addedComment],
  } = await db.query(sql, [interactionId, comment]);
  return addedComment;
}

export async function deleteComment(interactionId) {
  const sql = `UPDATE interactions
  SET user_comment= NULL
  WHERE id=$1 
  RETURNING *`;
  const {
    rows: [stance],
  } = await db.query(sql, [interactionId]);
  return stance;
}

export async function getAllUserInteractions(userId) {
  const sql = `SELECT * FROM interactions 
    WHERE user_id=$1`;
  const { rows: userInteractions } = await db.query(sql, [userId]);
  return userInteractions;
}

function toAlignmentSummary(summary) {
  const totalCount = summary?.total_count ?? 0;
  const approveCount = summary?.approve_count ?? 0;
  const disapproveCount = summary?.disapprove_count ?? 0;
  const hasData = totalCount > 0;
  const percent = hasData ? Math.round((approveCount / totalCount) * 100) : 0;

  return {
    totalCount,
    approveCount,
    disapproveCount,
    percent,
    hasData,
    emptyMessage: null,
  };
}

export async function getAlignmentByUserAndRep(
  userId,
  repBioguideId,
  options = {},
) {
  const { policyArea = null } = options;
  const sql = `SELECT
  COUNT(*)::integer AS total_count,
  COALESCE(SUM(CASE WHEN stance = 'approve' THEN 1 ELSE 0 END), 0)::integer AS approve_count,
  COALESCE(SUM(CASE WHEN stance = 'disapprove' THEN 1 ELSE 0 END), 0)::integer AS disapprove_count
  FROM interactions
  JOIN bills
    ON bills.id = interactions.bill_id
  WHERE user_id=$1 and rep_bioguide_id=$2${
    policyArea ? " AND bills.policy_area=$3" : ""
  }`;

  const {
    rows: [summary],
  } = await db.query(
    sql,
    policyArea ? [userId, repBioguideId, policyArea] : [userId, repBioguideId],
  );

  return toAlignmentSummary(summary);
}

export async function getUserInteractionsByBill(userId, billId) {
  const sql = `SELECT
    interactions.*,
    bill_comments.id AS comment_id,
    bill_comments.draft_text AS comment_draft_text,
    bill_comments.approved_text AS comment_approved_text,
    bill_comments.moderation_status AS comment_moderation_status,
    bill_comments.moderation_reason AS comment_moderation_reason,
    bill_comments.moderation_categories AS comment_moderation_categories,
    bill_comments.is_public AS comment_is_public,
    bill_comments.last_submitted_at AS comment_last_submitted_at,
    bill_comments.last_moderated_at AS comment_last_moderated_at,
    bill_comments.published_at AS comment_published_at,
    bill_comments.updated_at AS comment_updated_at
  FROM interactions
  LEFT JOIN bill_comments ON bill_comments.interaction_id = interactions.id
  WHERE interactions.user_id=$1 AND interactions.bill_id=$2`;
  const {
    rows: [userInteractionsOnBill],
  } = await db.query(sql, [userId, billId]);
  return userInteractionsOnBill;
}

export async function getInteractionById(id) {
  const sql = `SELECT * FROM interactions
  WHERE id =$1`;
  const {
    rows: [interaction],
  } = await db.query(sql, [id]);
  return interaction;
}
