import db from "../client.js";
import bcrypt from "bcrypt";

import { getDistrictFromAddress } from "./districts.js";

export async function createUser(
  email,
  password,
  first_name,
  last_name,
  address
) {
  const congressionalDistrict = await getDistrictFromAddress(address);
  const sql = `INSERT INTO users (email, password, first_name, last_name, district)
VALUES ($1,$2,$3,$4,$5)
RETURNING *;`;
  const hashedPassword = await bcrypt.hash(password, 10);
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
