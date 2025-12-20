import db from "../client.js";

export async function getHouseVotes() {
  const base = `http://localhost:${process.env.PORT || 4000}`;
  const houseVotesUrl = new URL("housevotes", base);

  const resp = await fetch(houseVotesUrl);
  if (!resp.ok) throw new Error(`getHouseVotes Query failed ${resp.status}`);
  const { houseVotes = [] } = await resp.json();
  await db.connect();
  const inserted = [];
  for (const vote of houseVotes) {
    for (const record of vote.votingRecord || []) {
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
  await db.end();
  console.log(inserted);
  return inserted;
}

getHouseVotes();
