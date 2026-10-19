import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import memberIds from "./member-ids-119.json" with { type: "json" };
import {
  type ParsedSenateVote,
  parseSenateMenu,
  parseSenateVote,
  type SenateBill,
} from "./parse.ts";
import { json } from "../_shared/http.ts";

const BATCH_SIZE = 12;
const RECHECK_RECENT = 2;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
type Client = SupabaseClient;

type NotificationMemberVote = {
  member_id: string;
  vote: string;
};

type ExistingNotificationMember = {
  member_id: string;
};

type ExistingBill = {
  title: string | null;
  summary: string | null;
};

type CongressBillSummary = {
  text?: string;
  updateDate?: string;
  actionDate?: string;
};

async function fetchText(url: string): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(12_000),
      });
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
      if (
        attempt === 3 ||
        (error instanceof Error && error.message.startsWith("Senate source"))
      ) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw new Error(`Senate source unavailable: ${url}`);
}

function voteUrl(congress: number, session: number, roll: number) {
  return `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${congress}${session}/vote_${congress}_${session}_${
    String(roll).padStart(5, "0")
  }.xml`;
}

async function fetchOfficialBillSummary(
  congress: number,
  bill: SenateBill,
  apiKey: string,
) {
  const url = new URL(
    `https://api.congress.gov/v3/bill/${congress}/${bill.type}/${bill.number}/summaries`,
  );
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `Congress summary lookup returned ${response.status} for ${bill.type} ${bill.number}`,
    );
  }

  const payload = await response.json();
  const summaries = Array.isArray(payload?.summaries)
    ? payload.summaries as CongressBillSummary[]
    : [];
  return summaries
    .filter((summary) =>
      typeof summary.text === "string" && summary.text.trim()
    )
    .sort((left, right) =>
      Date.parse(right.updateDate ?? right.actionDate ?? "") -
      Date.parse(left.updateDate ?? left.actionDate ?? "")
    )[0]?.text?.trim() ?? null;
}

async function ensureBill(
  client: Client,
  bill: SenateBill | null,
  congress: number,
  apiKey: string,
) {
  if (!bill) return;
  const { data: existing, error: lookupError } = await client.from("bills")
    .select("title,summary").eq("bill_type", bill.type).eq(
      "number",
      bill.number,
    ).limit(1);
  if (lookupError) throw lookupError;
  const existingBill = (existing?.[0] ?? null) as ExistingBill | null;
  if (existingBill?.summary?.trim()) return;

  let title = bill.title || existingBill?.title || "";
  if (!title) {
    const url = new URL(
      `https://api.congress.gov/v3/bill/${congress}/${bill.type}/${bill.number}`,
    );
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("format", "json");
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) {
      throw new Error(
        `Congress bill lookup returned ${response.status} for ${bill.type} ${bill.number}`,
      );
    }
    title = String((await response.json())?.bill?.title ?? "").trim();
  }
  if (!title) {
    throw new Error(`Missing official title for ${bill.type} ${bill.number}`);
  }

  let officialSummary: string | null = null;
  try {
    officialSummary = await fetchOfficialBillSummary(congress, bill, apiKey);
  } catch (error) {
    console.warn(
      `[sync-senate-votes] summary lookup deferred for ${bill.type} ${bill.number}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (existingBill) {
    const update: Record<string, string> = {};
    if (!existingBill.title?.trim()) update.title = title;
    if (!existingBill.summary?.trim() && officialSummary) {
      update.summary = officialSummary;
    }
    if (Object.keys(update).length === 0) return;
    const { error } = await client.from("bills").update(update)
      .eq("bill_type", bill.type).eq("number", bill.number);
    if (error) throw error;
    return;
  }

  const { error } = await client.from("bills").upsert({
    number: bill.number,
    bill_type: bill.type,
    title,
    summary: officialSummary ?? "",
  }, { onConflict: "bill_type,number", ignoreDuplicates: true });
  if (error) throw error;
}

async function enqueueVoteNotifications(
  client: Client,
  syncRunId: string,
  vote: ParsedSenateVote,
  rows: NotificationMemberVote[],
) {
  const bill = vote.bill;
  if (!bill || rows.length === 0) return 0;

  const memberIds = rows.map((row) => row.member_id);
  const { data: existing, error: lookupError } = await client
    .from("vote_notification_outbox")
    .select("member_id")
    .eq("chamber", "Senate")
    .eq("congress_number", vote.congress)
    .eq("session_number", vote.session)
    .eq("roll_call_number", vote.roll)
    .in("member_id", memberIds);
  if (lookupError) throw lookupError;

  const existingMemberIds = new Set(
    ((existing ?? []) as ExistingNotificationMember[]).map((row) =>
      row.member_id
    ),
  );
  const payload = rows
    .filter((row) => !existingMemberIds.has(row.member_id))
    .map((row) => ({
      sync_run_id: syncRunId,
      member_id: row.member_id,
      chamber: "Senate",
      congress_number: vote.congress,
      legislation_type: bill.type,
      legislation_number: bill.number,
      session_number: vote.session,
      roll_call_number: vote.roll,
      voted_on: vote.votedOn,
      vote: row.vote,
    }));

  if (payload.length === 0) return 0;

  const { data, error } = await client
    .from("vote_notification_outbox")
    .insert(payload)
    .select("member_id");
  if (error) throw error;
  return data?.length ?? 0;
}

async function saveVote(
  client: Client,
  syncRunId: string,
  vote: ParsedSenateVote,
  sourceUrl: string,
  apiKey: string,
) {
  const mapping = memberIds.members as Record<string, string>;
  const missing = vote.positions.filter((position) => !mapping[position.lisId]);
  if (missing.length) {
    throw new Error(
      `Roll ${vote.roll} has unmapped LIS IDs: ${
        missing.map((position) => position.lisId).join(", ")
      }`,
    );
  }
  if (
    new Set(vote.positions.map((position) => mapping[position.lisId])).size !==
      vote.positions.length
  ) {
    throw new Error(`Roll ${vote.roll} maps two positions to one Bioguide ID`);
  }
  await ensureBill(client, vote.bill, vote.congress, apiKey);

  const identity = {
    chamber: "Senate",
    congress_number: vote.congress,
    session_number: vote.session,
    roll_call_number: vote.roll,
  };
  const { error: summaryError } = await client.from("roll_call_summaries")
    .upsert({
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
    }, {
      onConflict: "chamber,congress_number,session_number,roll_call_number",
    });
  if (summaryError) throw summaryError;

  const rows = vote.positions.map((position) => ({
    ...identity,
    legislationnumber: vote.bill?.number ?? null,
    legislation_type: vote.bill?.type ?? null,
    voted_on: vote.votedOn,
    vote: position.vote === "Guilty"
      ? "Yea"
      : position.vote === "Not Guilty"
      ? "Nay"
      : position.vote,
    member_id: mapping[position.lisId],
  }));
  const { error: rowsError } = await client.from("member_voting_record").upsert(
    rows,
    {
      onConflict:
        "member_id,chamber,congress_number,session_number,roll_call_number",
    },
  );
  if (rowsError) throw rowsError;

  const queuedNotificationCount = await enqueueVoteNotifications(
    client,
    syncRunId,
    vote,
    rows,
  );

  // The notification rows are also persisted before the completion marker.
  // Retrying after a partial failure repairs writes without duplicating queued votes.
  const { error: markerError } = await client.from("senate_vote_ingestion")
    .upsert({
      congress_number: vote.congress,
      session_number: vote.session,
      roll_call_number: vote.roll,
      member_count: rows.length,
      source_modified_at: vote.modifiedOn,
      completed_at: new Date().toISOString(),
    }, { onConflict: "congress_number,session_number,roll_call_number" });
  if (markerError) throw markerError;
  return queuedNotificationCount;
}

async function syncSession(
  client: Client,
  syncRunId: string,
  congress: number,
  session: number,
  apiKey: string,
  allowance: number,
) {
  const menuUrl =
    `https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_${congress}_${session}.xml`;
  const rolls = parseSenateMenu(await fetchText(menuUrl), congress, session);
  const { data: completed, error } = await client.from("senate_vote_ingestion")
    .select("roll_call_number,source_modified_at,completed_at")
    .eq("congress_number", congress).eq("session_number", session)
    .limit(1000);
  if (error) throw error;
  const completedByRoll = new Map(
    (completed ?? []).map((row) => [row.roll_call_number, row]),
  );
  const missing = rolls.filter((roll) => !completedByRoll.has(roll)).reverse()
    .slice(0, allowance);
  const recheckBefore = Date.now() - 24 * 60 * 60 * 1000;
  const recent = rolls.slice(-RECHECK_RECENT).reverse().filter((roll) =>
    !missing.includes(roll) && (!completedByRoll.has(roll) ||
      Date.parse(completedByRoll.get(roll)!.completed_at) < recheckBefore)
  );
  let saved = 0;
  let queuedNotifications = 0;
  let checked = 0;
  const failures: Array<{ session: number; roll: number; error: string }> = [];
  for (const roll of [...missing, ...recent]) {
    try {
      const url = voteUrl(congress, session, roll);
      const vote = parseSenateVote(
        await fetchText(url),
        congress,
        session,
        roll,
      );
      checked++;
      if (
        completedByRoll.has(roll) &&
        completedByRoll.get(roll)!.source_modified_at === vote.modifiedOn
      ) {
        const { error: checkedError } = await client.from(
          "senate_vote_ingestion",
        )
          .update({ completed_at: new Date().toISOString() })
          .eq("congress_number", congress).eq("session_number", session).eq(
            "roll_call_number",
            roll,
          );
        if (checkedError) throw checkedError;
        continue;
      }
      queuedNotifications += await saveVote(
        client,
        syncRunId,
        vote,
        url,
        apiKey,
      );
      saved++;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error(
        `[sync-senate-votes] session ${session} roll ${roll}: ${message}`,
      );
      failures.push({ session, roll, error: message });
    }
  }
  return {
    published: rolls.length,
    missing: rolls.length - completedByRoll.size,
    saved,
    queuedNotifications,
    checked,
    failures,
  };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const congressApiKey = Deno.env.get("CONGRESS_API_KEY");
  if (!url || !key || !congressApiKey) {
    return json({ error: "Missing function secrets" }, 500);
  }

  try {
    const now = new Date();
    const year = now.getUTCFullYear();
    const congress = Math.floor((year - 1789) / 2) + 1;
    const currentSession = year % 2 === 1 ? 1 : 2;
    if (congress !== memberIds.congress) {
      throw new Error(
        `No reviewed Senate member crosswalk for Congress ${congress}`,
      );
    }
    const client = createClient(url, key);
    const syncRunId = crypto.randomUUID();
    const sessions = currentSession === 2 ? [2, 1] : [1];
    const results = [];
    let remaining = BATCH_SIZE;
    for (const session of sessions) {
      const result = await syncSession(
        client,
        syncRunId,
        congress,
        session,
        congressApiKey,
        remaining,
      );
      results.push({ session, ...result });
      remaining -= Math.min(result.missing, remaining);
    }
    const failures = results.flatMap((result) => result.failures);
    return json(
      { congress, syncRunId, results, failures },
      failures.length ? 500 : 200,
    );
  } catch (cause) {
    console.error(cause);
    return json({
      error: cause instanceof Error ? cause.message : String(cause),
    }, 500);
  }
});
