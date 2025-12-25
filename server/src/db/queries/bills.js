import db from "../client.js";

export async function getAllBillSummaries() {
  const base = `http://localhost:${process.env.PORT || 4000}`;
  const billsUrl = new URL("bills", base);

  const resp = await fetch(billsUrl);
  if (!resp.ok) throw new Error(`getAllBills Query failed ${resp.status}`);
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
    } = await db.query(sql, params);
    inserted.push(bill);
  }
  return inserted;
}
