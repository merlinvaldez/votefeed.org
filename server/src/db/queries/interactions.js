import db from "../client.js";
import { getAlignmentByUserAndMembers } from "./alignment.js";
import { findRepByBioguideId } from "./reps.js";

export async function addStance(userId, billId, rep_bioguide_id, stance, memberVoteId, runner = db) {
  const sql = `INSERT INTO interactions (user_id, bill_id, rep_bioguide_id, stance, member_vote_id)
  VALUES ($1,$2,$3,$4,$5)
  RETURNING *`;
  const {
    rows: [addedStance],
  } = await runner.query(sql, [userId, billId, rep_bioguide_id, stance, memberVoteId]);
  return addedStance;
}

export async function updateStance(interactionId, newStance, memberVoteId, runner = db) {
  const sql = `WITH updated_interaction AS (
    UPDATE interactions 
    SET stance =$2,
        member_vote_id = COALESCE($3, member_vote_id)
    WHERE id = $1
    RETURNING *
  ), cleared_contact_drafts AS (
    UPDATE bill_comments
    SET call_script = NULL,
        message_template = NULL,
        updated_at = now()
    WHERE interaction_id = $1
    RETURNING interaction_id
  )
  SELECT * FROM updated_interaction`;
  const {
    rows: [updatedStance],
  } = await runner.query(sql, [interactionId, newStance, memberVoteId ?? null]);
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
  const sql = `DELETE FROM bill_comments
  WHERE interaction_id=$1 
  RETURNING *`;
  const {
    rows: [deletedComment],
  } = await db.query(sql, [interactionId]);
  return deletedComment;
}

export async function getAllUserInteractions(userId) {
  const sql = `SELECT * FROM interactions 
    WHERE user_id=$1`;
  const { rows: userInteractions } = await db.query(sql, [userId]);
  return userInteractions;
}

export async function getAlignmentByUserAndRep(
  userId,
  repBioguideId,
  options = {},
) {
  const rep = await findRepByBioguideId(repBioguideId, options.runner ?? db);
  return getAlignmentByUserAndMembers(userId, rep ? [{
    memberId: rep.bioguideid,
    name: rep.full_name,
    chamber: rep.chamber === "Senate" ? "Senate" : "House",
  }] : [], options);
}

export async function getUserInteractionsByBill(userId, billId, { memberVoteId = null, repId = null } = {}) {
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
  WHERE interactions.user_id=$1 AND interactions.bill_id=$2
    AND ($3::integer IS NULL OR interactions.member_vote_id = $3 OR interactions.member_vote_id IS NULL)
    AND ($4::text IS NULL OR interactions.rep_bioguide_id = $4)
  ORDER BY (interactions.member_vote_id = $3) DESC NULLS LAST, interactions.id DESC
  LIMIT 1`;
  const {
    rows: [userInteractionsOnBill],
  } = await db.query(sql, [userId, billId, memberVoteId, repId]);
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
