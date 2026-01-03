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
  const { district, state } = await getDistrictFromAddress(address);
  const sql = `INSERT INTO users (email, password, first_name, last_name, district, state)
VALUES ($1,$2,$3,$4,$5,$6)
RETURNING *;`;
  const hashedPassword = await bcrypt.hash(password, 10);
  const {
    rows: [user],
  } = await db.query(sql, [
    email,
    hashedPassword,
    first_name,
    last_name,
    district,
    state,
  ]);
  return user;
}

export async function getUserByEmailAndPassword(email, password) {
  const sql = `SELECT * FROM users 
  WHERE email=$1`;
  const {
    rows: [user],
  } = await db.query(sql, [email]);
  if (!user) return null;
  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) return null;

  return user;
}

export async function getUserById(id) {
  const sql = `SELECT * FROM users
  WHERE id=$1`;
  const {
    rows: [user],
  } = await db.query(sql, [id]);
  return user;
}
