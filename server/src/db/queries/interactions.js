import db from "../client.js";

export async function addStance(userId, billId, stance) {
  const sql = `INSERT INTO interactions (user_id, bill_id, stance)
  VALUES ($1,$2,$3)
  RETURNING *`;
  const {
    rows: [addedStance],
  } = await db.query(sql, [userId, billId, stance]);
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

export async function getUserInteractionsByBill(userId, billId) {
  const sql = `SELECT * FROM interactions 
    WHERE user_id=$1 AND bill_id=$2`;
  const {
    rows: [userInteractionsOnBill],
  } = await db.query(sql, [userId, billId]);
  return userInteractionsOnBill;
}
