import db from "../client.js";
import { generateAiBillSummary } from "../../utils/aiSummaryPipeline.js";

export async function getAllBillSummaries(runner = db) {
  const base = `http://localhost:${process.env.PORT || 4000}`;
  const billsUrl = new URL("bills", base);

  const resp = await fetch(billsUrl);
  if (!resp.ok)
    throw new Error(`getAllBillsSummaries query failed ${resp.status}`);
  const { summaries = [] } = await resp.json();
  const inserted = [];
  for (const summary of summaries) {
    const sql = `INSERT INTO bills
    (number, title, summary)
    VALUES ($1, $2, $3)
    RETURNING *`;
    const params = [summary.bill.number, summary.bill.title, summary.text];
    const {
      rows: [bill],
    } = await runner.query(sql, params);
    inserted.push(bill);
  }
  return inserted;
}

export async function getBillSummary(legislationNumber) {
  const sql = `SELECT * FROM bills
  WHERE number=$1`;
  const { rows } = await db.query(sql, [legislationNumber]);
  return rows;
}

export async function getOrCreateAiBillSummary(legislationNumber) {
  const billRows = await getBillSummary(legislationNumber);
  const bill = billRows?.[0];
  if (!bill) return null;
  if (typeof bill.aisummary === "string" && bill.aisummary.trim() !== "") {
    return bill.aisummary;
  }
  const aiSummary = await generateAiBillSummary(bill.summary);
  const sql = `UPDATE bills
    SET aisummary=$1
    WHERE number=$2
    RETURNING aisummary`;

  const { rows } = await db.query(sql, [aiSummary, legislationNumber]);
  return rows?.[0]?.aisummary ?? aiSummary;
}
