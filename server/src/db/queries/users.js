import db from "../client.js";

import { getDistrictFromAddress } from "./districts.js";
import { resolveElectionGeography } from "../../elections/electionGeography.js";
import { ELECTION_GEOGRAPHY_SOURCE, ELECTION_GEOGRAPHY_VERSION } from "../../elections/contracts.js";
import { saveElectionGeography } from "./elections.js";

async function saveAddressGeography(address, state, runner) {
  let resolved = null;
  try {
    resolved = await resolveElectionGeography(address);
  } catch {
    // A 2026-boundary lookup outage must not block the existing district save.
  }
  const evidence = resolved?.geographyEvidence ?? {
    state,
    district: null,
    cycle: 2026,
    boundaryVersion: ELECTION_GEOGRAPHY_VERSION,
    sourceUrl: ELECTION_GEOGRAPHY_SOURCE,
    checkedAt: new Date().toISOString(),
    status: "unresolved",
  };
  return saveElectionGeography(evidence, runner);
}

export async function upsertUserByClerkId(
  { clerk_user_id, email, first_name, last_name, address },
  runner = db,
) {
  const { district, state } = await getDistrictFromAddress(address);
  const electionGeography = await saveAddressGeography(address, state, runner);
  const sql = `INSERT INTO users (
    clerk_user_id,
    email,
    first_name,
    last_name,
    state,
    district,
    election_geography_evidence_id
  )
  VALUES ($1,$2,$3,$4,$5,$6,$7)
  ON CONFLICT (clerk_user_id)
  DO UPDATE SET
    email=$2,
    first_name=$3,
    last_name=$4,
    state=$5,
    district=$6,
    election_geography_evidence_id=$7
  RETURNING *;`;
  const {
    rows: [user],
  } = await runner.query(sql, [
    clerk_user_id,
    email,
    first_name,
    last_name,
    state,
    district,
    electionGeography.id,
  ]);
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
  const electionGeography = await saveAddressGeography(address, state, db);
  const sql = `UPDATE users 
  SET state=$1,
      district=$2,
      election_geography_evidence_id=$4,
      last_notified_session_number=NULL,
      last_notified_roll_call_number=NULL
  WHERE id=$3
  RETURNING *`;
  const {
    rows: [user],
  } = await db.query(sql, [state, district, id, electionGeography.id]);
  return user;
}

export async function updateUserNotificationsEnabled(
  id,
  notificationsEnabled,
  runner = db,
) {
  const sql = `UPDATE users
  SET notifications_enabled=$1
  WHERE id=$2
  RETURNING *`;
  const {
    rows: [user],
  } = await runner.query(sql, [notificationsEnabled, id]);
  return user;
}

export async function findUsersToNotifyForRepVote(
  { state, district, sessionNumber, rollCallNumber },
  runner = db,
) {
  const sql = `SELECT
      id,
      email,
      first_name,
      last_name,
      state,
      district,
      last_notified_session_number,
      last_notified_roll_call_number
    FROM users
    WHERE notifications_enabled = true
      AND email IS NOT NULL
      AND state = $1
      AND district = $2
      AND (
        last_notified_session_number IS NULL
        OR last_notified_roll_call_number IS NULL
        OR last_notified_session_number < $3
        OR (
          last_notified_session_number = $3
          AND last_notified_roll_call_number < $4
        )
      )`;
  const { rows: users } = await runner.query(sql, [
    state,
    district,
    sessionNumber,
    rollCallNumber,
  ]);
  return users;
}

export async function markUserVoteNotificationSent(
  userId,
  { sessionNumber, rollCallNumber },
  runner = db,
) {
  const sql = `UPDATE users
  SET last_notified_session_number=$1,
      last_notified_roll_call_number=$2
  WHERE id = $3
  RETURNING *`;
  const {
    rows: [user],
  } = await runner.query(sql, [sessionNumber, rollCallNumber, userId]);
  return user;
}
