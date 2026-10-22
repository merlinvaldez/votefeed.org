import db from "../client.js";
import { readDelegationFeedRecords } from "./delegationVotes.js";
import { matchesSummaryMeasure } from "../../utils/summaryMeasure.js";

const fail = (status, message) => Object.assign(new Error(message), { status });

export async function readBillDelegation(location, { congress, billType, billNumber, cardId = null, runner = db } = {}) {
  const { rows: [bill] } = await runner.query(
    "SELECT * FROM bills WHERE bill_type = $1 AND number = $2", [billType, billNumber]);
  if (!bill || !matchesSummaryMeasure(bill, congress, billType, billNumber)) {
    throw fail(404, "Bill not found in the requested Congress");
  }
  const feed = await readDelegationFeedRecords(location, { runner, includeSummaries: false });
  const cards = feed.cards.filter(card => card.bill.id === bill.id && card.bill.congress === congress);
  if (cardId && !cards.some(card => card.id === cardId)) {
    throw fail(409, "This recorded action has changed or is no longer in your delegation. Return to the feed and reopen it.");
  }
  // Results belong to an exact event, never the most recent action on a bill
  // in another chamber or Congress. Missing totals stay explicitly unavailable.
  const { rows: results } = cards.length ? await runner.query(`SELECT * FROM roll_call_summaries
    WHERE congress_number = $1 AND legislation_type = $2 AND legislation_number = $3`,
  [congress, billType, billNumber]) : { rows: [] };
  return { bill, delegation: feed.delegation, warnings: feed.warnings,
    cards: cards.map(card => ({ ...card,
      summary: { officialHtml: bill.summary || null, simplifiedText: bill.aisummary || null },
      result: results.find(result =>
      result.chamber === card.event.chamber && result.session_number === card.event.session &&
      result.roll_call_number === card.event.rollCall) ?? null })) };
}
