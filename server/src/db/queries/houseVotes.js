import db from "../client.js";

const RETRYABLE_MEMBER_STATUSES = new Set([429, 500, 502, 503, 504]);
const PROGRESS_EVERY = 250;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchMembersWithRetry(membersUrl, maxAttempts = 4) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const membersResp = await fetch(membersUrl);
    if (membersResp.ok) {
      const { members = [] } = await membersResp.json();
      return members;
    }

    const details = await membersResp.text();
    lastError = new Error(
      `getHouseVotes members failed ${membersResp.status} for ${membersUrl} - ${details}`,
    );
    const shouldRetry =
      RETRYABLE_MEMBER_STATUSES.has(membersResp.status) &&
      attempt < maxAttempts;

    if (!shouldRetry) {
      throw lastError;
    }

    console.warn(
      `[getHouseVotes] retry ${attempt}/${maxAttempts - 1} for ${membersUrl} after status ${membersResp.status}`,
    );
    await wait(attempt * 1000);
  }

  throw lastError;
}

async function insertMemberVote(runner, vote, record) {
  const sql = `INSERT INTO member_voting_record
    (legislationNumber, vote, member_id)
    SELECT $1, $2, $3
    WHERE NOT EXISTS (
      SELECT 1
      FROM member_voting_record
      WHERE legislationNumber = $1
        AND vote = $2
        AND member_id = $3
    )
    RETURNING *`;
  const params = [vote.legislationNumber, record.voteCast, record.bioguideID];
  const {
    rows: [repVote],
  } = await runner.query(sql, params);
  return repVote ?? null;
}

export async function getHouseVotes(runner = db) {
  const base = `http://localhost:${process.env.PORT || 4000}`;
  const listUrl = new URL("housevotes", base);
  const listResp = await fetch(listUrl);
  if (!listResp.ok)
    throw new Error(`getHouseVotes Query failed ${listResp.status}`);
  const { houseVotes = [] } = await listResp.json();
  const inserted = [];
  let processedCount = 0;
  let duplicateCount = 0;
  let skippedRollCalls = 0;

  for (const vote of houseVotes) {
    let members = [];

    try {
      members =
        Array.isArray(vote.votingRecord) && vote.votingRecord.length > 0
          ? vote.votingRecord
          : await (async () => {
              const membersUrl = new URL(
                `housevotes/${vote.sessionNumber}/${vote.rollCallNumber}`,
                base,
              );
              return fetchMembersWithRetry(membersUrl);
            })();
    } catch (err) {
      skippedRollCalls += 1;
      console.warn(
        `[getHouseVotes] skipping session ${vote.sessionNumber} roll call ${vote.rollCallNumber}: ${err.message}`,
      );
      continue;
    }

    for (const record of members) {
      const repVote = await insertMemberVote(runner, vote, record);
      processedCount += 1;

      if (!repVote) {
        duplicateCount += 1;
      } else {
        inserted.push(repVote);
      }

      if (processedCount % PROGRESS_EVERY === 0) {
        console.log(
          `[getHouseVotes] processed ${processedCount} vote records (${inserted.length} inserted, ${duplicateCount} duplicates)`,
        );
      }
    }
  }

  console.log(
    `[getHouseVotes] finished. processed ${processedCount} vote records, inserted ${inserted.length}, skipped ${skippedRollCalls} roll calls, ignored ${duplicateCount} duplicates.`,
  );

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
