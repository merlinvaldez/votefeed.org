import db from "../client.js";

export async function getHouseVotes() {
  const base = `http://localhost:${process.env.PORT || 4000}`;
  const listUrl = new URL("housevotes", base);
  const listResp = await fetch(listUrl);
  if (!listResp.ok)
    throw new Error(`getHouseVotes Query failed ${listResp.status}`);
  const { houseVotes = [] } = await listResp.json();
  const inserted = [];
  for (const vote of houseVotes) {
    const membersUrl = new URL(
      `housevotes/${vote.sessionNumber}/${vote.rollCallNumber}`,
      base,
    );
    const membersResp = await fetch(membersUrl);
    if (!membersResp.ok) {
      throw new Error(
        `getHouseVotes members failed ${membersResp.status} for ${membersUrl}`,
      );
    }
    const { members = [] } = await membersResp.json();
    for (const record of members) {
      const sql = `INSERT INTO member_voting_record
    (legislationNumber, vote, member_id)
    VALUES
    ($1, $2, $3)
    RETURNING *`;
      const params = [
        vote.legislationNumber,
        record.voteCast,
        record.bioguideID,
      ];
      const {
        rows: [repVote],
      } = await db.query(sql, params);
      inserted.push(repVote);
    }
  }
  return inserted;
}

export async function findMemberVotes(bioguideId, options = {}) {
  const { limit, offset = 0 } = options;
  const hasLimit = Number.isInteger(limit) && limit > 0;
  const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const sql = `SELECT
  bills.id AS bill_id,
  member_voting_record.legislationNumber,
  bills.title,
  bills.summary,
  member_voting_record.vote
FROM member_voting_record
JOIN bills ON bills.number = member_voting_record.legislationNumber
WHERE member_voting_record.member_id = $1`;
  const orderSql = " ORDER BY member_voting_record.id DESC";
  const pageSql = hasLimit ? " LIMIT $2 OFFSET $3" : "";
  const finalSql = `${sql}${orderSql}${pageSql}`;
  const params = hasLimit ? [bioguideId, limit, safeOffset] : [bioguideId];
  const { rows: memberVotes } = await db.query(finalSql, params);
  return memberVotes;
}
