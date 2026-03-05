import db from "./client.js";

import { upsertUserByClerkId } from "./queries/users.js";
import { getAllReps } from "./queries/reps.js";
import { getAllBillSummaries } from "./queries/bills.js";
import { getHouseVotes } from "./queries/houseVotes.js";

await db.connect();
await seed();
await db.end();
console.log("Database Seeded! 🌱🪴🌴");

async function seed() {
  const user = await upsertUserByClerkId({
    clerk_user_id: "user_seed_merlin",
    email: "merlinvaldez@gmail.com",
    first_name: "Merlin",
    last_name: "Valdez",
    address: "66 Saint Nicholas Avenue, apt 2F, New York, NY, 10026",
  });
  console.log("getting reps");
  const reps = await getAllReps();
  console.log("getting bills");
  const bills = await getAllBillSummaries();
  console.log("getting votes");
  const votes = await getHouseVotes();

  console.log({
    user,
    reps: reps.length,
    bills: bills.length,
    votes: votes.length,
  });
}
