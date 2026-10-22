import { matchesSummaryMeasure } from "../../utils/summaryMeasure.js";
import { isUsableQuickSummary } from "../../utils/quickSummaryValidation.js";
import db from "../client.js";
import { generateAiBillSummary } from "../../utils/aiSummaryPipeline.js";

async function getBillMetadata(billApiUrl) {
  if (!billApiUrl) {
    return { policyArea: null, legislationUrl: null };
  }
  const apiKey = process.env.CONGRESS_API_KEY;
  if (!apiKey) throw new Error("Missing Congres API key");
  const detailUrl = new URL(billApiUrl);
  detailUrl.searchParams.set("api_key", apiKey);
  const resp = await fetch(detailUrl);
  if (!resp.ok) {
    throw new Error(`getBillMetadata query failed ${resp.status}`);
  }
  const { bill } = await resp.json();
  return {
    policyArea: bill?.policyArea?.name ?? null,
    legislationUrl: bill?.legislationUrl ?? null,
  };
}

export async function getAllBillSummaries(runner = db, options = {}) {
  const { billType = "hr", fromDateTime } = options;
  const base = `http://localhost:${process.env.PORT || 4000}`;
  const billsUrl = new URL("bills", base);
  billsUrl.searchParams.set("billType", String(billType).toLowerCase());
  if (fromDateTime) {
    billsUrl.searchParams.set("fromDateTime", fromDateTime);
  }

  const resp = await fetch(billsUrl);
  if (!resp.ok)
    throw new Error(`getAllBillsSummaries query failed ${resp.status}`);
  const { summaries = [] } = await resp.json();
  const inserted = [];
  for (const summary of summaries) {
    const metadata = await getBillMetadata(summary.bill?.url);
    const sql = `INSERT INTO bills
    (number, bill_type, title, summary, policy_area, legislation_url)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (bill_type, number) DO UPDATE SET
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      policy_area= EXCLUDED.policy_area,
      legislation_url=COALESCE(EXCLUDED.legislation_url,bills.legislation_url)
    RETURNING *`;
    const params = [
      summary.bill.number,
      String(summary.bill.type).toLocaleLowerCase(),
      summary.bill.title,
      summary.text,
      metadata.policyArea,
      metadata.legislationUrl,
    ];
    const {
      rows: [bill],
    } = await runner.query(sql, params);
    inserted.push(bill);
  }
  return inserted;
}

export async function getMissingBillSummaryTargets(runner = db) {
  const sql = `SELECT
    m.legislation_type AS bill_type,
    MIN(m.voted_on) AS from_date_time,
    COUNT(DISTINCT m.legislationnumber)::integer AS missing_bill_count
  FROM member_voting_record m
  LEFT JOIN bills b
    ON b.number = m.legislationnumber
   AND b.bill_type = m.legislation_type
  WHERE (
  b.id IS NULL 
  OR b.policy_area IS NULL 
  OR b.legislation_url IS NULL)
    AND m.legislation_type IS NOT NULL
    AND m.voted_on IS NOT NULL
  GROUP BY m.legislation_type
  ORDER BY MIN(m.voted_on) ASC`;
  const { rows } = await runner.query(sql);
  return rows;
}

export async function syncMissingBillSummaries(runner = db) {
  const targets = await getMissingBillSummaryTargets(runner);
  const results = [];
  let syncedBillTypeCount = 0;
  let upsertedBillCount = 0;

  for (const target of targets) {
    const bills = await getAllBillSummaries(runner, {
      billType: target.bill_type,
      fromDateTime: target.from_date_time,
    });
    syncedBillTypeCount += 1;
    upsertedBillCount += bills.length;
    results.push({
      billType: target.bill_type,
      fromDateTime: target.from_date_time,
      missingBillCount: target.missing_bill_count,
      upsertedBillCount: bills.length,
    });
  }

  return {
    syncedBillTypeCount,
    upsertedBillCount,
    results,
  };
}

export async function getBillById(id, runner = db) {
  const sql = `SELECT * FROM bills WHERE id=$1`;
  const {
    rows: [bill],
  } = await runner.query(sql, [id]);
  return bill ?? null;
}

export async function getBillSummary(legislationNumber, billType, runner = db) {
  const sql = `WITH latest_roll_call_summary AS (
    SELECT DISTINCT ON (legislation_number, legislation_type)
      legislation_number,
      legislation_type,
      voted_on,
      result,
      yes_count,
      no_count,
      not_voting_count
    FROM roll_call_summaries
    ORDER BY
      legislation_number,
      legislation_type,
      voted_on DESC NULLS LAST,
      session_number DESC,
      roll_call_number DESC,
      id DESC
  )
  SELECT
    bills.*,
    latest_roll_call_summary.voted_on AS latest_vote_date,
    latest_roll_call_summary.result AS vote_result,
    latest_roll_call_summary.yes_count AS vote_yes_count,
    latest_roll_call_summary.no_count AS vote_no_count,
    latest_roll_call_summary.not_voting_count AS vote_not_voting_count
  FROM bills
  LEFT JOIN latest_roll_call_summary
    ON latest_roll_call_summary.legislation_number = bills.number
   AND latest_roll_call_summary.legislation_type = bills.bill_type
  WHERE bills.number = $1
    AND bills.bill_type = $2`;
  const { rows } = await runner.query(sql, [legislationNumber, billType]);
  return rows;
}

const pendingSummaries = new Map();

export async function getOrCreateAiBillSummary(legislationNumber, billType, congress = null, options = {}) {
  const runner = options.runner ?? db;
  const generate = options.generate ?? generateAiBillSummary;
  const billRows = await getBillSummary(legislationNumber, billType, runner);
  const bill = billRows?.[0];
  if (!bill || (congress !== null && !matchesSummaryMeasure(bill, congress, billType, legislationNumber))) return null;
  if (isUsableQuickSummary(bill.aisummary, bill.summary)) {
    return bill.aisummary;
  }
  const source = bill.summary?.trim() || bill.title?.trim();
  const key = JSON.stringify([bill.id, bill.legislation_url, source]);
  if (pendingSummaries.has(key)) return pendingSummaries.get(key);
  const task = (async () => {
    const generatedSummary = await generate(source);
    const aiSummary = isUsableQuickSummary(generatedSummary, bill.summary)
      ? generatedSummary
      : null;
    if (!aiSummary) throw Object.assign(new Error("Summary generation did not produce valid content"), {
      code: "AI_SUMMARY_UNAVAILABLE", status: 503,
    });
    const sql = `UPDATE bills
      SET aisummary=$1
      WHERE id=$2 AND legislation_url IS NOT DISTINCT FROM $3
        AND summary IS NOT DISTINCT FROM $4
        AND title IS NOT DISTINCT FROM $5
      RETURNING aisummary`;

    const { rows } = await runner.query(sql, [
      aiSummary,
      bill.id,
      bill.legislation_url,
      bill.summary,
      bill.title,
    ]);
    if (!rows?.[0]?.aisummary) throw Object.assign(new Error("Bill text changed during summary generation; retry"), {
      code: "AI_SUMMARY_UNAVAILABLE", status: 503,
    });
    return rows[0].aisummary;
  })();
  pendingSummaries.set(key, task);
  try { return await task; } finally { pendingSummaries.delete(key); }
}
