import db from "../client";
import bcrypt from "bcrypt";

export async function createUser(
  email,
  password,
  first_name,
  last_name,
  address
) {
  const base = `http://localhost:${process.env.PORT || 4000}`;
  const districtUrl = new URL("districts", base);
  districtUrl.searchParams.set(`address`, address);

  const resp = await fetch(districtUrl);
  if (!resp.ok) throw new Error(`District lookup Query fialed ${resp.status}`);
  const { congressionalDistrict } = await resp.json();
  if (!congressionalDistrict) throw new Error("District mission from response");
  const sql = `INSERT INTO users (email, password, first_name, last_name, district)
VALUES ($1,$2,$3,$4,$5)
RETURNING *;`;
  const hashedPassword = bcrypt.hash(password, 10);
  const {
    rows: [user],
  } = await db.query(sql, [
    email,
    hashedPassword,
    first_name,
    last_name,
    congressionalDistrict,
  ]);
  return user;
}
