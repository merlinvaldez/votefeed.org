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

async function insertMemberVotes(runner, vote, members) {
  const legislationNumbers = [];
  const legislationTypes = [];
  const sessionNumbers = [];
  const rollCallNumbers = [];
  const votedOnDates = [];
  const voteCasts = [];
  const memberIds = [];

  for (const record of members) {
    if (!record?.bioguideID || !record?.voteCast) continue;
    legislationNumbers.push(Number(vote.legislationNumber));
    legislationTypes.push(String(vote.legislationType).toLowerCase());
    sessionNumbers.push(Number(vote.sessionNumber));
    rollCallNumbers.push(Number(vote.rollCallNumber));
    votedOnDates.push(vote.startDate);
    voteCasts.push(record.voteCast);
    memberIds.push(record.bioguideID);
  }

  if (memberIds.length === 0) {
    return { attemptedCount: 0, insertedCount: 0 };
  }

  const sql = `WITH incoming AS (
      SELECT *
      FROM unnest(
        $1::integer[],
        $2::text[],
        $3::integer[],
        $4::integer[],
        $5::timestamptz[],
        $6::text[],
        $7::text[]
      ) AS incoming(
        legislation_number,
        legislation_type,
        session_number,
        roll_call_number,
        voted_on,
        vote,
        member_id
      )
    ),
    inserted AS (
      INSERT INTO member_voting_record
        (legislationNumber, legislation_type, session_number, roll_call_number, voted_on, vote, member_id)
      SELECT
        incoming.legislation_number,
        incoming.legislation_type,
        incoming.session_number,
        incoming.roll_call_number,
        incoming.voted_on,
        incoming.vote,
        incoming.member_id
      FROM incoming
      WHERE NOT EXISTS (
        SELECT 1
        FROM member_voting_record
        WHERE member_id = incoming.member_id
          AND session_number = incoming.session_number
          AND roll_call_number = incoming.roll_call_number
      )
      RETURNING 1
    )
    SELECT
      (SELECT COUNT(*)::integer FROM incoming) AS attempted_count,
      (SELECT COUNT(*)::integer FROM inserted) AS inserted_count`;
  const {
    rows: [result],
  } = await runner.query(sql, [
    legislationNumbers,
    legislationTypes,
    sessionNumbers,
    rollCallNumbers,
    votedOnDates,
    voteCasts,
    memberIds,
  ]);

  return {
    attemptedCount: result?.attempted_count ?? 0,
    insertedCount: result?.inserted_count ?? 0,
  };
}

export async function getHouseVotes(runner = db) {
  const base = `http://localhost:${process.env.PORT || 4000}`;
  const listUrl = new URL("housevotes", base);
  const listResp = await fetch(listUrl);
  if (!listResp.ok)
    throw new Error(`getHouseVotes Query failed ${listResp.status}`);
  const { houseVotes = [] } = await listResp.json();
  let processedCount = 0;
  let insertedCount = 0;
  let duplicateCount = 0;
  let skippedRollCalls = 0;
  let nextProgressLog = PROGRESS_EVERY;

  for (const vote of houseVotes) {
    if (!vote.legislationNumber || !vote.legislationType || !vote.startDate) {
      continue;
    }

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

    const rollCallResult = await insertMemberVotes(runner, vote, members);
    processedCount += rollCallResult.attemptedCount;
    insertedCount += rollCallResult.insertedCount;
    duplicateCount +=
      rollCallResult.attemptedCount - rollCallResult.insertedCount;

    while (processedCount >= nextProgressLog) {
      console.log(
        `[getHouseVotes] processed ${processedCount} vote records (${insertedCount} inserted, ${duplicateCount} duplicates)`,
      );
      nextProgressLog += PROGRESS_EVERY;
    }
  }

  console.log(
    `[getHouseVotes] finished. processed ${processedCount} vote records, inserted ${insertedCount}, skipped ${skippedRollCalls} roll calls, ignored ${duplicateCount} duplicates.`,
  );

  return {
    processedCount,
    insertedCount,
    duplicateCount,
    skippedRollCalls,
  };
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
