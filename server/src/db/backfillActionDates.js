import "dotenv/config";
import db from "./client.js";

const apiKey = process.env.CONGRESS_API_KEY;
const fromDateTime = "2025-01-01T00:00:00Z";

async function main() {
  if (!apiKey) throw new Error("Missing CONGRESS_API_KEY");
  const actionDatesByBill = new Map();

  let nextUrl = new URL("https://api.congress.gov/v3/house-vote/119");
  nextUrl.searchParams.set("limit", 250);
  nextUrl.searchParams.set("fromDateTime", fromDateTime);
  nextUrl.searchParams.set("api_key", apiKey);

  while (nextUrl) {
    const resp = await fetch(nextUrl);
    if (!resp.ok) throw new Error(`House votes fetch failed (${resp.status})`);
    const data = await resp.json();

    for (const vote of data.houseRollCallVotes ?? []) {
      if (!vote.legislationNumber || !vote.legislationType || !vote.startDate)
        continue;
      const billNumber = Number(vote.legislationNumber);
      const billType = vote.legislationType.toLowerCase();
      const billKey = `${billType}:${billNumber}`;
      const savedDate = actionDatesByBill.get(billKey);
      const nextDateMs = new Date(vote.startDate).getTime();
      const savedDateMs = savedDate
        ? new Date(savedDate.actionDate).getTime()
        : -Infinity;
      if (nextDateMs > savedDateMs)
        actionDatesByBill.set(billKey, {
          billNumber,
          billType,
          actionDate: vote.startDate,
        });
    }

    const paginationNext = data.pagination?.next;
    if (!paginationNext) {
      nextUrl = null;
      continue;
    }
    nextUrl = new URL(paginationNext);
    nextUrl.searchParams.set("api_key", apiKey);
  }

  let updatedCount = 0;
  for (const {
    billNumber,
    billType,
    actionDate,
  } of actionDatesByBill.values()) {
    const result = await db.query(
      `UPDATE bills SET action_date = $1 WHERE number = $2 AND bill_type=$3 AND action_date is NULL`,
      [actionDate, billNumber, billType],
    );
    updatedCount += result.rowCount;
  }

  console.log(`Backfilled action_date for ${updatedCount} bills.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
