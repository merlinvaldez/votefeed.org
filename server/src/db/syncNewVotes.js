import "dotenv/config";
import db from "./client.js";
import {
  getFreshestVotedOn,
  getHouseVotes,
} from "./queries/houseVotes.js";
import { groupInsertedVotesByRep } from "../utils/groupInsertedVotesbyRep.js";
import { findRepByBioguideId, findRepByDistrict } from "./queries/reps.js";
import { getBillSummary } from "./queries/bills.js";
import {
  markUserVoteNotificationSent,
} from "./queries/users.js";
import { sendEmail } from "../utils/resendClient.js";
import { buildRepVoteBatchEmail } from "../utils/buildRepVoteBatchEmail.js";

function isInitialNotificationUser(user) {
  return (
    user?.last_notified_session_number == null ||
    user?.last_notified_roll_call_number == null
  );
}

function groupVotesByRollCall(votes = []) {
  const grouped = new Map();

  for (const vote of votes) {
    const key = `${vote.sessionNumber}:${vote.rollCallNumber}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(vote);
  }

  return [...grouped.values()];
}

function hasBillSummary(vote) {
  return String(vote?.billSummary ?? "").trim() !== "";
}

function getSummaryReadyRollCallGroups(votes = []) {
  return groupVotesByRollCall(votes).filter((rollCallVotes) =>
    rollCallVotes.every(hasBillSummary)
  );
}

function isVoteNewerThanCursor(vote, user) {
  const lastSession = user?.last_notified_session_number;
  const lastRollCall = user?.last_notified_roll_call_number;

  return (
    lastSession == null ||
    lastRollCall == null ||
    vote.sessionNumber > lastSession ||
    (vote.sessionNumber === lastSession &&
      vote.rollCallNumber > lastRollCall)
  );
}

function buildVotesForUser(user, summaryReadyRollCallGroups = []) {
  const groupsNewerThanCursor = summaryReadyRollCallGroups.filter(
    (rollCallVotes) => isVoteNewerThanCursor(rollCallVotes[0], user),
  );

  if (groupsNewerThanCursor.length === 0) {
    return [];
  }

  if (isInitialNotificationUser(user)) {
    return groupsNewerThanCursor[0];
  }

  return groupsNewerThanCursor.flat();
}

async function findUsersNeedingBootstrapNotification(runner = db) {
  const sql = `SELECT
      id,
      email,
      first_name,
      last_name,
      state,
      district,
      last_notified_session_number,
      last_notified_roll_call_number
    FROM users
    WHERE notifications_enabled = true
      AND email IS NOT NULL
      AND state IS NOT NULL
      AND district IS NOT NULL
      AND (
        last_notified_session_number IS NULL
        OR last_notified_roll_call_number IS NULL
      )`;
  const { rows } = await runner.query(sql);
  return rows;
}

async function findNotificationUsersForDistrict(state, district, runner = db) {
  const sql = `SELECT
      id,
      email,
      first_name,
      last_name,
      state,
      district,
      last_notified_session_number,
      last_notified_roll_call_number
    FROM users
    WHERE notifications_enabled = true
      AND email IS NOT NULL
      AND state = $1
      AND district = $2`;
  const { rows } = await runner.query(sql, [state, district]);
  return rows;
}

async function findLatestSummaryReadyRollCallVotesForRep(memberId, runner = db) {
  const sql = `SELECT
      m.legislationnumber,
      m.legislation_type,
      m.session_number,
      m.roll_call_number,
      m.voted_on,
      m.vote,
      b.title,
      b.summary,
      b.legislation_url
    FROM member_voting_record m
    LEFT JOIN bills b
      ON b.number = m.legislationnumber
     AND b.bill_type = m.legislation_type
    WHERE m.member_id = $1
    ORDER BY m.voted_on DESC NULLS LAST, m.session_number DESC, m.roll_call_number DESC, m.id DESC
    LIMIT 250`;
  const { rows } = await runner.query(sql, [memberId]);

  if (rows.length === 0) {
    return [];
  }

  const normalizedVotes = rows.map((vote) => ({
    legislationNumber: vote.legislationnumber,
    legislationType: vote.legislation_type,
    sessionNumber: vote.session_number,
    rollCallNumber: vote.roll_call_number,
    votedOn: vote.voted_on,
    vote: vote.vote,
    billTitle:
      vote.title ??
      `${String(vote.legislation_type).toUpperCase()} ${vote.legislationnumber}`,
    billSummary: vote.summary ?? null,
    legislationUrl: vote.legislation_url,
  }));

  return getSummaryReadyRollCallGroups(normalizedVotes)[0] ?? [];
}

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
          billSummary: bill?.summary ?? null,
          legislationUrl: bill?.legislation_url ?? null,
        };
      }),
    );
    const summaryReadyRollCallGroups = getSummaryReadyRollCallGroups(enrichedVotes);
    if (summaryReadyRollCallGroups.length === 0) {
      continue;
    }

    const users = await findNotificationUsersForDistrict(
      rep.state,
      rep.congressionaldistrict,
      db,
    );
    repNotificationTargets.push({
      memberId: batch.memberId,
      repName: rep.full_name,
      state: rep.state,
      district: rep.congressionaldistrict,
      userCount: users.length,
      users,
      summaryReadyRollCallGroups,
    });
  }

  const pendingMemberIds = new Set(groupedVotesByRep.map((batch) => batch.memberId));
  const bootstrapUsers = await findUsersNeedingBootstrapNotification(db);
  const bootstrapTargets = new Map();

  for (const user of bootstrapUsers) {
    const rep = await findRepByDistrict(user.state, user.district);
    if (!rep) continue;
    if (pendingMemberIds.has(rep.bioguideid)) continue;

    let target = bootstrapTargets.get(rep.bioguideid);
    if (!target) {
      const latestVotes = await findLatestSummaryReadyRollCallVotesForRep(
        rep.bioguideid,
        db,
      );
      if (latestVotes.length === 0) continue;
      target = {
        repName: rep.full_name,
        votes: latestVotes,
        users: [],
      };
      bootstrapTargets.set(rep.bioguideid, target);
    }

    target.users.push(user);
  }

  let sentEmailCount = 0;
  for (const target of repNotificationTargets) {
    if (target.users.length === 0) continue;
    for (const user of target.users) {
      const votesForUser = buildVotesForUser(
        user,
        target.summaryReadyRollCallGroups,
      );
      if (votesForUser.length === 0) continue;
      const email = buildRepVoteBatchEmail({
        firstName: user.first_name,
        repName: target.repName,
        votes: votesForUser,
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
          sessionNumber: votesForUser[0].sessionNumber,
          rollCallNumber: votesForUser[0].rollCallNumber,
        },
        db,
      );
      sentEmailCount += 1;
    }
  }

  for (const target of bootstrapTargets.values()) {
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
          sessionNumber: target.votes[0].sessionNumber,
          rollCallNumber: target.votes[0].rollCallNumber,
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
