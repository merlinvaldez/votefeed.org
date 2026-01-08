import db from "../client.js";

export async function addStance(userId, billId, stance) {
  const sql = `INSERT INTO interactions (user_id, bill_id, stance)
  VALUES ($1,$2,$3)
  RETURNING *`;
  const {
    rows: [stance],
  } = await db.query(sql, [userId, billId, stance]);
  return stance;
}

export async function updateStance(stanceId, newStance) {
  sql = ``;
}

export async function removeStanceAndComment(stanceId) {
  const sql = `DELETE from interactions where id=$1 RETURNING *`;
  const result = await db.query(sql, [stanceId]);
  return (result = result.rows[0] || null);
}

export async function addComment(userId, billId, comment) {
  const sql = `INSERT INTO interactions (user_id, bill_id, user_comment)
    VALUES ($1, $2, $3)
    RETURNING *`;
  const {
    rows: [comment],
  } = await db.query(sql, [userId, billId, comment]);
  return comment;
}

export async function getAllUserInteractions(userId) {
  const sql = `SELECT * FROM interactions 
    WHERE user_id=$1`;
  const {
    rows: [userInteractions],
  } = await db.query(sql, [userId]);
  return userInteractions;
}

export async function getUserInteractionsByBill(userId, billId) {
  const sql = `SELECT * FROM interactions 
    WHERE user_id=$1 AND bill_id=$2`;
  const {
    rows: [userInteractionsOnBill],
  } = db.query(sql, [userId, billId]);
  return userInteractionsOnBill;
}
