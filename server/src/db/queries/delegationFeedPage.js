import db from "../client.js";
import { findCurrentDelegation } from "./delegation.js";
import { readDelegationFeedRecords } from "./delegationVotes.js";
import { postgresFeedSnapshots } from "./feedSnapshots.js";
import { paginateFeed } from "../../utils/feedPagination.js";

// API adapters must pass the authenticated saved user or the guest location;
// user identity is supplied by the authentication middleware, never URL claims.
export async function readDelegationFeedPage(location, options = {}) {
  const { runner = db, userId = null, ...pageOptions } = options;
  const delegation = await findCurrentDelegation(location, runner);
  const scope = {
    viewer: userId === null ? "guest" : `user:${userId}`,
    state: delegation.state.trim().toLowerCase(), district: delegation.district,
    members: [delegation.houseMember, ...delegation.senators].filter(Boolean)
      .map(member => [member.bioguideid, member.chamber])
      .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  };
  return paginateFeed({ ...pageOptions, scope, store: postgresFeedSnapshots(runner),
    load: () => readDelegationFeedRecords(location, {
      runner, resolvedDelegation: delegation, policyArea: pageOptions.policyArea ?? null,
    }),
    validateSnapshot: async snapshot => {
      const expected = snapshot.payload.cards.flatMap(card => card.members.map(member => ({ card, member })));
      if (!expected.length) return true;
      const { rows } = await runner.query(`SELECT m.*,
        to_char(m.voted_on AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS precise_date,
        b.id AS bill_id, b.legislation_url
        FROM member_voting_record m JOIN bills b
          ON b.bill_type = m.legislation_type AND b.number = m.legislationnumber
        WHERE m.id = ANY($1::integer[])`, [expected.map(item => item.member.memberVoteId)]);
      const sources = new Map(rows.map(row => [row.id, row]));
      return expected.every(({ card, member }) => {
        const row = sources.get(member.memberVoteId);
        return row && row.member_id === member.bioguideId && row.chamber === card.event.chamber &&
          row.congress_number === card.event.congress && row.session_number === card.event.session &&
          row.roll_call_number === card.event.rollCall && row.vote === card.position &&
          row.precise_date === card.votedOn && row.bill_id === card.bill.id &&
          row.legislation_url === card.bill.legislationUrl;
      });
    },
  });
}
