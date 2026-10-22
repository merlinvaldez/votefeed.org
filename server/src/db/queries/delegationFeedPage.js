import db from "../client.js";
import { findCurrentDelegation } from "./delegation.js";
import { readDelegationFeedRecords } from "./delegationVotes.js";
import { postgresFeedSnapshots } from "./feedSnapshots.js";
import { paginateFeed } from "../../utils/feedPagination.js";
import { getPublicBillCommentCounts } from "./comments.js";

// API adapters must pass the authenticated saved user or the guest location;
// user identity is supplied by the authentication middleware, never URL claims.
export async function readDelegationFeedPage(location, options = {}) {
  const { runner = db, userId = null, chamber = "All Reps", ...pageOptions } = options;
  if (!["All Reps", "House", "Senate"].includes(chamber)) throw Object.assign(new Error("Invalid chamber"), { status: 400, code: "INVALID_FEED_CURSOR" });
  const delegation = await findCurrentDelegation(location, runner);
  const scope = {
    chamber,
    viewer: userId === null ? "guest" : `user:${userId}`,
    state: delegation.state.trim().toLowerCase(), district: delegation.district,
    members: [delegation.houseMember, ...delegation.senators].filter(Boolean)
      .map(member => [member.bioguideid, member.chamber])
      .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  };
  const page = await paginateFeed({ ...pageOptions, scope, store: postgresFeedSnapshots(runner),
    load: () => readDelegationFeedRecords(location, {
      runner, resolvedDelegation: delegation, policyArea: pageOptions.policyArea ?? null, chamber,
      includeSummaries: false,
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
  return enrichFeedPage(page, runner);
}

// Snapshots freeze card membership/order, not discussion totals. Fetch large
// summaries once per displayed bill instead of per roll call across the roster.
export async function enrichFeedPage(page, runner = db) {
  const ids = [...new Set(page.cards.map(card => card.bill.id))];
  if (!ids.length) return page;
  const { rows } = await runner.query("SELECT id, summary, aisummary FROM bills WHERE id = ANY($1::integer[])", [ids]);
  const summaries = new Map(rows.map(row => [row.id, {
    officialHtml: row.summary || null, simplifiedText: row.aisummary || null,
  }]));
  let counts;
  const warnings = [...(page.warnings ?? [])];
  try {
    counts = await getPublicBillCommentCounts(ids, runner);
  } catch (error) {
    console.error("Comment count query failed", error);
    warnings.push({ code: "PUBLIC_COMMENT_COUNTS_UNAVAILABLE",
      message: "Comment counts are unavailable. Open a bill to view its discussion." });
  }
  return { ...page, warnings,
    dataStatus: warnings.length ? "partial" : page.dataStatus,
    retry: counts ? page.retry : { mode: "refresh", message: "Refresh to retry comment counts." },
    cards: page.cards.map(card => ({ ...card,
      publicCommentCount: counts ? counts.get(card.bill.id) : null,
      summary: summaries.get(card.bill.id) ?? { officialHtml: null, simplifiedText: null },
    })),
  };
}
