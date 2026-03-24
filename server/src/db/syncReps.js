import "dotenv/config";
import db from "./client.js";
import { getAllReps } from "./queries/reps.js";

async function main() {
  const reps = await getAllReps(db);
  console.log({ reps: reps.length });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
