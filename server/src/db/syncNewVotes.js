import "dotenv/config";
import db from "./client.js";
import { getFreshestVotedOn, getHouseVotes } from "./queries/houseVotes.js";
import { groupInsertedVotesByRep } from "../utils/groupInsertedVotesbyRep.js";
import { findRepByBioguideId } from "./queries/reps.js";
import { getBillSummary } from "./queries/bills.js";
import {
  findUsersToNotifyForRepVote,
  markUserVoteNotificationSent,
} from "./queries/users.js";
import { sendEmail } from "../utils/resendClient.js";
import { buildRepVoteBatchEmail } from "../utils/buildRepVoteBatchEmail.js";

async function main() {
  const freshest = await getFreshestVotedOn();
  console.log({ freshest });
  const summary = await getHouseVotes(
    db,
    freshest ? { fromDateTime: freshest } : {},
  );
  const groupedVotesByRep = groupInsertedVotesByRep(summary.insertedRows);
  const repNotificationTargets = [];
  for (const batch of groupedVotesByRep) {
    const rep = await findRepByBioguideId(batch.memberId, db);
    if (!rep) {
      console.warn(`[syncNewVotes] missing rep for member ${batch.memberId}`);
      continue;
    }
    const enrichedVotes = await Promise.all(
      batch.votes.map(async (vote) => {
        const [bill] = await getBillSummary(
          vote.legislationNumber,
          vote.legislationType,
        );
        return {
          ...vote,
          billTitle:
            bill?.title ??
            `${String(vote.legislationType).toUpperCase()} ${vote.legislationNumber}`,
          legislationUrl: bill?.legislation_url ?? null,
        };
      }),
    );
    const newestVote = enrichedVotes[0];

    const users = await findUsersToNotifyForRepVote(
      {
        state: rep.state,
        district: rep.congressionaldistrict,
        sessionNumber: newestVote.sessionNumber,
        rollCallNumber: newestVote.rollCallNumber,
      },
      db,
    );
    repNotificationTargets.push({
      memberId: batch.memberId,
      repName: rep.full_name,
      state: rep.state,
      district: rep.congressionaldistrict,
      userCount: users.length,
      users,
      votes: enrichedVotes,
    });
  }

  let sentEmailCount = 0;
  for (const target of repNotificationTargets) {
    if (target.users.length === 0) continue;
    const newestVote = target.votes[0];
    for (const user of target.users) {
      const email = buildRepVoteBatchEmail({
        firstName: user.first_name,
        repName: target.repName,
        votes: target.votes,
      });
      await sendEmail({
        to: user.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
      await markUserVoteNotificationSent(
        user.id,
        {
          sessionNumber: newestVote.sessionNumber,
          rollCallNumber: newestVote.rollCallNumber,
        },
        db,
      );
      sentEmailCount += 1;
    }
  }
  console.log({
    processedCount: summary.processedCount,
    insertedCount: summary.insertedCount,
    duplicateCount: summary.duplicateCount,
    skippedRollCalls: summary.skippedRollCalls,
    groupedRepCount: groupedVotesByRep.length,
    repNotificationTargetCount: repNotificationTargets.length,
    sentEmailCount,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
