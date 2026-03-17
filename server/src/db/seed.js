import db from "./client.js";

import { upsertUserByClerkId } from "./queries/users.js";
import { getAllReps } from "./queries/reps.js";
import { getAllBillSummaries } from "./queries/bills.js";
import { getHouseVotes } from "./queries/houseVotes.js";

const client = await db.connect();

try {
  const baseSeed = await seedBaseTables(client);
  console.log("getting votes");
  const votes = await getHouseVotes();

  console.log({
    ...baseSeed,
    votes: votes.length,
  });
  console.log("Database Seeded!");
} finally {
  client.release();
  await db.end();
}

async function seedBaseTables(runner) {
  try {
    await runner.query("BEGIN");
    const user = await upsertUserByClerkId(
      {
        clerk_user_id: "user_seed_merlin",
        email: "merlinvaldez@gmail.com",
        first_name: "Merlin",
        last_name: "Valdez",
        address: "66 Saint Nicholas Avenue, apt 2F, New York, NY, 10026",
      },
      runner,
    );
    console.log("getting reps");
    const reps = await getAllReps(runner);
    console.log("getting bills");
    const bills = await getAllBillSummaries(runner);
    await runner.query("COMMIT");

    return {
      user,
      reps: reps.length,
      bills: bills.length,
    };
  } catch (err) {
    await runner.query("ROLLBACK");
    throw err;
  }
}
