import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import memberIds from "./member-ids-119.json" with { type: "json" };
import { parseSenateMenu, parseSenateVote, type ParsedSenateVote, type SenateBill } from "./parse.ts";
import { json } from "../_shared/http.ts";

const BATCH_SIZE = 12;
const RECHECK_RECENT = 2;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
type Client = ReturnType<typeof createClient>;

async function fetchText(url: string): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
      if (!response.ok) {
        if (RETRYABLE.has(response.status) && attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 750));
          continue;
        }
        throw new Error(`Senate source returned ${response.status}: ${url}`);
      }
      const body = await response.text();
      if (!body.trimStart().startsWith("<?xml")) {
        throw new Error(`Senate source did not return XML: ${url}`);
      }
      return body;
    } catch (error) {
      if (attempt === 3 || (error instanceof Error && error.message.startsWith("Senate source"))) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw new Error(`Senate source unavailable: ${url}`);
}

function voteUrl(congress: number, session: number, roll: number) {
  return `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${congress}${session}/vote_${congress}_${session}_${String(roll).padStart(5, "0")}.xml`;
}

async function ensureBill(client: Client, bill: SenateBill | null, congress: number, apiKey: string) {
  if (!bill) return;
  const { data: existing, error: lookupError } = await client.from("bills")
    .select("id").eq("bill_type", bill.type).eq("number", bill.number).limit(1);
  if (lookupError) throw lookupError;
  if (existing?.length) return;

  let title = bill.title;
  if (!title) {
    const url = new URL(`https://api.congress.gov/v3/bill/${congress}/${bill.type}/${bill.number}`);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("format", "json");
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`Congress bill lookup returned ${response.status} for ${bill.type} ${bill.number}`);
    title = String((await response.json())?.bill?.title ?? "").trim();
  }
  if (!title) throw new Error(`Missing official title for ${bill.type} ${bill.number}`);
  const { error } = await client.from("bills").upsert({
    number: bill.number,
    bill_type: bill.type,
    title,
    summary: "",
  }, { onConflict: "bill_type,number", ignoreDuplicates: true });
  if (error) throw error;
}

async function saveVote(client: Client, vote: ParsedSenateVote, sourceUrl: string, apiKey: string) {
  const mapping = memberIds.members as Record<string, string>;
  const missing = vote.positions.filter((position) => !mapping[position.lisId]);
  if (missing.length) {
    throw new Error(`Roll ${vote.roll} has unmapped LIS IDs: ${missing.map((position) => position.lisId).join(", ")}`);
  }
  if (new Set(vote.positions.map((position) => mapping[position.lisId])).size !== vote.positions.length) {
    throw new Error(`Roll ${vote.roll} maps two positions to one Bioguide ID`);
  }
  await ensureBill(client, vote.bill, vote.congress, apiKey);

  const identity = {
    chamber: "Senate",
    congress_number: vote.congress,
    session_number: vote.session,
    roll_call_number: vote.roll,
  };
  const { error: summaryError } = await client.from("roll_call_summaries").upsert({
    ...identity,
    legislation_number: vote.bill?.number ?? null,
    legislation_type: vote.bill?.type ?? null,
    voted_on: vote.votedOn,
    result: vote.result || "Unknown",
    yes_count: vote.yes,
    no_count: vote.no,
    not_voting_count: vote.notVoting,
    vote_title: vote.title,
    vote_question: vote.question,
    source_url: sourceUrl,
  }, { onConflict: "chamber,congress_number,session_number,roll_call_number" });
  if (summaryError) throw summaryError;

  const rows = vote.positions.map((position) => ({
    ...identity,
    legislationnumber: vote.bill?.number ?? null,
    legislation_type: vote.bill?.type ?? null,
    voted_on: vote.votedOn,
    vote: position.vote === "Guilty" ? "Yea" : position.vote === "Not Guilty" ? "Nay" : position.vote,
    member_id: mapping[position.lisId],
  }));
  const { error: rowsError } = await client.from("member_voting_record").upsert(rows, {
    onConflict: "member_id,chamber,congress_number,session_number,roll_call_number",
  });
  if (rowsError) throw rowsError;

  // A marker is committed last. Retrying any earlier failure repairs partial writes.
  const { error: markerError } = await client.from("senate_vote_ingestion").upsert({
    congress_number: vote.congress,
    session_number: vote.session,
    roll_call_number: vote.roll,
    member_count: rows.length,
    source_modified_at: vote.modifiedOn,
    completed_at: new Date().toISOString(),
  }, { onConflict: "congress_number,session_number,roll_call_number" });
  if (markerError) throw markerError;
}

async function syncSession(client: Client, congress: number, session: number, apiKey: string, allowance: number) {
  const menuUrl = `https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_${congress}_${session}.xml`;
  const rolls = parseSenateMenu(await fetchText(menuUrl), congress, session);
  const { data: completed, error } = await client.from("senate_vote_ingestion")
    .select("roll_call_number,source_modified_at,completed_at")
    .eq("congress_number", congress).eq("session_number", session)
    .limit(1000);
  if (error) throw error;
  const completedByRoll = new Map((completed ?? []).map((row) => [row.roll_call_number, row]));
  const missing = rolls.filter((roll) => !completedByRoll.has(roll)).reverse().slice(0, allowance);
  const recheckBefore = Date.now() - 24 * 60 * 60 * 1000;
  const recent = rolls.slice(-RECHECK_RECENT).reverse().filter((roll) =>
    !missing.includes(roll) && (!completedByRoll.has(roll) ||
      Date.parse(completedByRoll.get(roll)!.completed_at) < recheckBefore)
  );
  let saved = 0;
  let checked = 0;
  const failures: Array<{ session: number; roll: number; error: string }> = [];
  for (const roll of [...missing, ...recent]) {
    try {
      const url = voteUrl(congress, session, roll);
      const vote = parseSenateVote(await fetchText(url), congress, session, roll);
      checked++;
      if (completedByRoll.has(roll) && completedByRoll.get(roll)!.source_modified_at === vote.modifiedOn) {
        const { error: checkedError } = await client.from("senate_vote_ingestion")
          .update({ completed_at: new Date().toISOString() })
          .eq("congress_number", congress).eq("session_number", session).eq("roll_call_number", roll);
        if (checkedError) throw checkedError;
        continue;
      }
      await saveVote(client, vote, url, apiKey);
      saved++;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error(`[sync-senate-votes] session ${session} roll ${roll}: ${message}`);
      failures.push({ session, roll, error: message });
    }
  }
  return { published: rolls.length, missing: rolls.length - completedByRoll.size, saved, checked, failures };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const congressApiKey = Deno.env.get("CONGRESS_API_KEY");
  if (!url || !key || !congressApiKey) return json({ error: "Missing function secrets" }, 500);

  try {
    const now = new Date();
    const year = now.getUTCFullYear();
    const congress = Math.floor((year - 1789) / 2) + 1;
    const currentSession = year % 2 === 1 ? 1 : 2;
    if (congress !== memberIds.congress) {
      throw new Error(`No reviewed Senate member crosswalk for Congress ${congress}`);
    }
    const client = createClient(url, key);
    const sessions = currentSession === 2 ? [2, 1] : [1];
    const results = [];
    let remaining = BATCH_SIZE;
    for (const session of sessions) {
      const result = await syncSession(client, congress, session, congressApiKey, remaining);
      results.push({ session, ...result });
      remaining -= Math.min(result.missing, remaining);
    }
    const failures = results.flatMap((result) => result.failures);
    return json({ congress, results, failures }, failures.length ? 500 : 200);
  } catch (cause) {
    console.error(cause);
    return json({ error: cause instanceof Error ? cause.message : String(cause) }, 500);
  }
});
