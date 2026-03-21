import "dotenv/config";
import db from "./client.js";
import { getFreshestVotedOn, getHouseVotes } from "./queries/houseVotes.js";

async function main() {
  const freshest = await getFreshestVotedOn();
  console.log({ freshest });
  const summary = await getHouseVotes(
    db,
    freshest ? { fromDateTime: freshest } : {},
  );
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
