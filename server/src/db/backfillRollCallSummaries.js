import "dotenv/config";
import db from "./client.js";

const distinctRollCallsSql = `SELECT DISTINCT
  legislationnumber,
  legislation_type,
  session_number,
  roll_call_number,
  voted_on
FROM member_voting_record
WHERE session_number IS NOT NULL
  AND roll_call_number IS NOT NULL
ORDER BY voted_on ASC NULLS LAST, session_number ASC, roll_call_number ASC`;

const upsertSummarySql = `INSERT INTO roll_call_summaries (
  legislation_number,
  legislation_type,
  session_number,
  roll_call_number,
  voted_on,
  result,
  yes_count,
  no_count,
  not_voting_count
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (session_number, roll_call_number) DO UPDATE SET
  legislation_number = EXCLUDED.legislation_number,
  legislation_type = EXCLUDED.legislation_type,
  voted_on = EXCLUDED.voted_on,
  result = EXCLUDED.result,
  yes_count = EXCLUDED.yes_count,
  no_count = EXCLUDED.no_count,
  not_voting_count = EXCLUDED.not_voting_count`;

async function main() {
  const base = `http://localhost:${process.env.PORT || 4000}`;
  const {
    rows: rollCalls,
  } = await db.query(distinctRollCallsSql);
  let processedCount = 0;

  for (const rollCall of rollCalls) {
    const summaryUrl = new URL(
      `housevotes/${rollCall.session_number}/${rollCall.roll_call_number}/summary`,
      base,
    );
    const resp = await fetch(summaryUrl);
    if (!resp.ok) {
      const details = await resp.text();
      throw new Error(
        `Backfill failed ${resp.status} for ${summaryUrl} - ${details}`,
      );
    }

    const summary = await resp.json();
    await db.query(upsertSummarySql, [
      rollCall.legislationnumber,
      rollCall.legislation_type,
      rollCall.session_number,
      rollCall.roll_call_number,
      rollCall.voted_on,
      summary.result,
      Number(summary.totals.yes ?? 0),
      Number(summary.totals.no ?? 0),
      Number(summary.totals.notVoting ?? 0),
    ]);

    processedCount += 1;
    if (processedCount % 25 === 0) {
      console.log(
        `Backfilled ${processedCount}/${rollCalls.length} roll call summaries`,
      );
    }
  }

  console.log(`Backfilled ${processedCount} roll call summaries.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
