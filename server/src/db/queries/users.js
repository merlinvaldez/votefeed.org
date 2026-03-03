import db from "../client.js";
import bcrypt from "bcrypt";

import { getDistrictFromAddress } from "./districts.js";

export async function createUser(
  email,
  password,
  first_name,
  last_name,
  address,
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

export async function upsertUserByClerkId({
  clerk_user_id,
  email,
  first_name,
  last_name,
  address,
}) {
  const { district, state } = await getDistrictFromAddress(address);
  const sql = `INSERT INTO users (clerk_user_id, email, first_name, last_name, state, district)
  VALUES ($1,$2,$3,$4,$5,$6)
  ON CONFLICT (clerk_user_id)
  DO UPDATE SET email=$2, first_name=$3, last_name=$4, state=$5, district=$6
  RETURNING *;`;
  const {
    rows: [user],
  } = await db.query(sql, [
    clerk_user_id,
    email,
    first_name,
    last_name,
    state,
    district,
  ]);
  return user;
}

export async function getUserByEmailAndPassword(email, password) {
  const sql = `SELECT * FROM users 
  WHERE email=$1`;
  const {
    rows: [user],
  } = await db.query(sql, [email]);
  if (!user || !user.password) return null;
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

export async function getUserByClerkId(clerkUserId) {
  const sql = `SELECT * FROM users
  WHERE clerk_user_id=$1`;
  const {
    rows: [user],
  } = await db.query(sql, [clerkUserId]);
  return user;
}

export async function updateUserDistrict(id, address) {
  const { district, state } = await getDistrictFromAddress(address);
  const sql = `UPDATE users 
  SET state=$1, district=$2
  WHERE id=$3
  RETURNING *`;
  const {
    rows: [user],
  } = await db.query(sql, [state, district, id]);
  return user;
}
