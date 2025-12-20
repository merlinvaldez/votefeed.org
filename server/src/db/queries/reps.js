import db from "../client.js";

export async function getAllReps() {
  const base = `http://localhost:${process.env.PORT || 4000}`;
  const repsUrl = new URL("reps", base);

  const resp = await fetch(repsUrl);
  if (!resp.ok) throw new Error(`getAllReps Query failed ${resp.status}`);
  const { members = [] } = await resp.json();
  await db.connect();
  const inserted = [];
  for (const rep of members) {
    const sql = `INSERT INTO reps
    (bioguideId, full_name, district)
    VALUES
    ($1, $2, $3)
    RETURNING *`;
    const params = [rep.bioguideId, rep.name, rep.district];
    const {
      rows: [representative],
    } = await db.query(sql, params);
    inserted.push(representative);
  }
  await db.end();
  console.log(inserted);
  return inserted;
}

getAllReps();

// TODO : delete the db connect, db end and the function calls after done testing
