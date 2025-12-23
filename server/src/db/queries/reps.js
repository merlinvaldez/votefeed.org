import db from "../client.js";

export async function getAllReps() {
  const base = `http://localhost:${process.env.PORT || 4000}`;
  const repsUrl = new URL("reps", base);

  const resp = await fetch(repsUrl);
  if (!resp.ok) throw new Error(`getAllReps Query failed ${resp.status}`);
  const { members = [] } = await resp.json();
  const inserted = [];
  for (const rep of members) {
    const sql = `INSERT INTO reps
    (bioguideId, full_name, party, chamber, state, congressionalDistrict)
    VALUES
    ($1, $2, $3, $4, $5, $6)
    RETURNING *`;
    const params = [
      rep.bioguideId,
      rep.name,
      rep.partyName,
      rep.terms.item[0].chamber,
      rep.state,
      rep.district,
    ];
    const {
      rows: [representative],
    } = await db.query(sql, params);
    inserted.push(representative);
  }
  return inserted;
}

export async function findRepByDistrict(state, congressionalDistrict) {
  const sql = ` SELECT * FROM reps 
  WHERE state=$1 AND congressionalDistrict=$2 
`;

  const {
    rows: [rep],
  } = await db.query(sql, [state, congressionalDistrict]);
  return rep;
}
