import "dotenv/config";
import db from "./client.js";
import { syncMissingBillSummaries } from "./queries/bills.js";

async function main() {
  const summary = await syncMissingBillSummaries(db);
  console.log(summary);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
