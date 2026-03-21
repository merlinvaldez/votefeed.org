import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CONGRESS_API_ORIGIN = "https://api.congress.gov";
const RETRYABLE_MEMBER_STATUSES = new Set([429, 500, 502, 503, 504]);
const wait = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

type HouseVoteRecord = {
  bioguideID?: string;
  voteCast?: string;
};

type HouseVote = {
  legislationNumber?: string | number;
  legislationType?: string;
  sessionNumber?: string | number;
  rollCallNumber?: string | number;
  startDate?: string;
  votingRecord?: HouseVoteRecord[];
};

type MemberVotingRecordRow = {
  legislationnumber: number;
  legislation_type: string;
  session_number: number;
  roll_call_number: number;
  voted_on: string;
  vote: string;
  member_id: string;
};

type BillSummary = {
  bill?: {
    number?: string | number;
    type?: string;
    title?: string;
  };
  text?: string;
};

type BillSummaryRow = {
  number: number;
  bill_type: string;
  title: string;
  summary: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function toCongressDateTimeString(value: Date) {
  return value.toISOString().replace(".000Z", "Z");
}

function toCongressNextUrl(paginationNext: string, apiKey: string) {
  const next = new URL(paginationNext, CONGRESS_API_ORIGIN);
  next.searchParams.set("api_key", apiKey);
  return next.toString();
}

async function fetchHouseVotes(apiKey: string, fromDateTime: string | null) {
  const baseUrl = new URL("https://api.congress.gov/v3/house-vote/119");
  baseUrl.searchParams.set("limit", "250");
  baseUrl.searchParams.set("api_key", apiKey);

  let houseVotes: HouseVote[] = [];
  let nextUrl: string | null = baseUrl.toString();

  while (nextUrl) {
    const response = await fetch(nextUrl);
    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `Congress house-vote fetch failed ${response.status}: ${details}`,
      );
    }

    const data = await response.json();
    houseVotes = houseVotes.concat(data?.houseRollCallVotes ?? []);

    const paginationNext = data?.pagination?.next ?? null;
    nextUrl = paginationNext ? toCongressNextUrl(paginationNext, apiKey) : null;
  }

  if (fromDateTime) {
    const parsedFromDateTime = Date.parse(fromDateTime);
    houseVotes = houseVotes.filter((vote) => {
      const voteStartDateMs = Date.parse(vote?.startDate ?? "");
      return (
        Number.isFinite(voteStartDateMs) &&
        voteStartDateMs >= parsedFromDateTime
      );
    });
  }

  return houseVotes;
}

async function fetchBillSummaries(
  apiKey: string,
  billType: string,
  fromDateTime: string,
) {
  const baseUrl = new URL(
    `https://api.congress.gov/v3/summaries/119/${billType}`,
  );
  baseUrl.searchParams.set("limit", "250");
  baseUrl.searchParams.set(
    "fromDateTime",
    toCongressDateTimeString(new Date(Date.parse(fromDateTime))),
  );
  baseUrl.searchParams.set("api_key", apiKey);

  let summaries: BillSummary[] = [];
  let nextUrl: string | null = baseUrl.toString();

  while (nextUrl) {
    const response = await fetch(nextUrl);
    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `Congress summaries fetch failed ${response.status} for ${billType}: ${details}`,
      );
    }

    const data = await response.json();
    summaries = summaries.concat(data?.summaries ?? []);

    const paginationNext = data?.pagination?.next ?? null;
    nextUrl = paginationNext ? toCongressNextUrl(paginationNext, apiKey) : null;
  }

  return summaries;
}

function buildBillSummaryTargets(houseVotes: HouseVote[]) {
  const targets = new Map<string, number>();

  for (const vote of houseVotes) {
    if (!vote?.legislationType || !vote?.startDate) continue;
    const billType = String(vote.legislationType).toLowerCase();
    const voteStartDateMs = Date.parse(vote.startDate);
    if (!Number.isFinite(voteStartDateMs)) continue;
    const currentMin = targets.get(billType);
    if (currentMin === undefined || voteStartDateMs < currentMin) {
      targets.set(billType, voteStartDateMs);
    }
  }

  return Array.from(targets, ([billType, fromDateTimeMs]) => ({
    billType,
    fromDateTime: toCongressDateTimeString(new Date(fromDateTimeMs)),
  }));
}

async function fetchRollCallMembersWithRetry(
  apiKey: string,
  sessionNumber: string | number | undefined,
  rollCallNumber: string | number | undefined,
  maxAttempts = 4,
) {
  if (!sessionNumber || !rollCallNumber) {
    return [];
  }

  const baseUrl = new URL(
    `https://api.congress.gov/v3/house-vote/119/${sessionNumber}/${rollCallNumber}/members`,
  );
  baseUrl.searchParams.set("limit", "250");
  baseUrl.searchParams.set("api_key", apiKey);

  let members: HouseVoteRecord[] = [];
  let nextUrl: string | null = baseUrl.toString();

  while (nextUrl) {
    let response: Response | null = null;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      response = await fetch(nextUrl);
      if (response.ok) {
        break;
      }

      const details = await response.text();
      lastError = new Error(
        `Congress house-vote members fetch failed ${response.status} for ${nextUrl}: ${details}`,
      );
      const shouldRetry =
        RETRYABLE_MEMBER_STATUSES.has(response.status) &&
        attempt < maxAttempts;

      if (!shouldRetry) {
        throw lastError;
      }

      console.warn(
        `[sync-votes] retry ${attempt}/${maxAttempts - 1} for session ${sessionNumber} roll call ${rollCallNumber} after status ${response.status}`,
      );
      await wait(attempt * 1000);
    }

    if (!response || !response.ok) {
      throw lastError ?? new Error("Unexpected member vote fetch failure");
    }

    const data = await response.json();
    const pageObj = data?.houseRollCallVoteMemberVotes || {};
    members = members.concat(pageObj.results || []);

    const paginationNext = data?.pagination?.next ?? null;
    nextUrl = paginationNext ? toCongressNextUrl(paginationNext, apiKey) : null;
  }

  return members;
}

function buildRollCallRows(vote: HouseVote, votingRecord: HouseVoteRecord[]) {
  if (!vote.legislationNumber || !vote.legislationType || !vote.startDate) {
    return [];
  }

  return votingRecord
    .filter((record) => record?.bioguideID && record?.voteCast)
    .map((record) => ({
      legislationnumber: Number(vote.legislationNumber),
      legislation_type: String(vote.legislationType).toLowerCase(),
      session_number: Number(vote.sessionNumber),
      roll_call_number: Number(vote.rollCallNumber),
      voted_on: vote.startDate!,
      vote: record.voteCast!,
      member_id: record.bioguideID!,
    }));
}

async function upsertRollCallRows(
  supabase: ReturnType<typeof createClient>,
  rows: MemberVotingRecordRow[],
) {
  if (rows.length === 0) {
    return { attemptedCount: 0, insertedCount: 0 };
  }

  const { data, error } = await supabase
    .from("member_voting_record")
    .upsert(rows, {
      onConflict: "member_id,session_number,roll_call_number",
      ignoreDuplicates: true,
      defaultToNull: false,
    })
    .select("member_id");

  if (error) {
    throw error;
  }

  return {
    attemptedCount: rows.length,
    insertedCount: data?.length ?? 0,
  };
}

function buildBillSummaryRows(summaries: BillSummary[]) {
  return summaries
    .filter((summary) => summary?.bill?.number && summary?.bill?.type && summary?.bill?.title && typeof summary?.text === "string")
    .map((summary) => ({
      number: Number(summary.bill!.number),
      bill_type: String(summary.bill!.type).toLowerCase(),
      title: summary.bill!.title!,
      summary: summary.text!,
    }));
}

async function upsertBillSummaryRows(
  supabase: ReturnType<typeof createClient>,
  rows: BillSummaryRow[],
) {
  if (rows.length === 0) {
    return { attemptedCount: 0, upsertedCount: 0 };
  }

  const { data, error } = await supabase
    .from("bills")
    .upsert(rows, {
      onConflict: "bill_type,number",
      ignoreDuplicates: false,
      defaultToNull: false,
    })
    .select("id");

  if (error) {
    throw error;
  }

  return {
    attemptedCount: rows.length,
    upsertedCount: data?.length ?? 0,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const congressApiKey = Deno.env.get("CONGRESS_API_KEY");

  if (!supabaseUrl || !serviceRoleKey || !congressApiKey) {
    return json({ error: "Missing function secrets" }, 500);
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await supabase
      .from("member_voting_record")
      .select("voted_on")
      .not("voted_on", "is", null)
      .order("voted_on", { ascending: false })
      .limit(1);

    if (error) {
      console.error(error);
      return json({ error: error.message }, 500);
    }

    const freshestVotedOn = data?.[0]?.voted_on ?? null;
    const houseVotes = await fetchHouseVotes(congressApiKey, freshestVotedOn);
    let processedCount = 0;
    let insertedCount = 0;
    let skippedRollCalls = 0;
    let billSummaryProcessedCount = 0;
    let billSummaryUpsertedCount = 0;

    for (const vote of houseVotes) {
      const members =
        Array.isArray(vote.votingRecord) && vote.votingRecord.length > 0
          ? vote.votingRecord
          : await fetchRollCallMembersWithRetry(
              congressApiKey,
              vote.sessionNumber,
              vote.rollCallNumber,
            );
      const rows = buildRollCallRows(vote, members);
      if (rows.length === 0) {
        skippedRollCalls += 1;
        continue;
      }

      const summary = await upsertRollCallRows(supabase, rows);
      processedCount += summary.attemptedCount;
      insertedCount += summary.insertedCount;
    }

    const billSummaryTargets = buildBillSummaryTargets(houseVotes);
    for (const target of billSummaryTargets) {
      const summaries = await fetchBillSummaries(
        congressApiKey,
        target.billType,
        target.fromDateTime,
      );
      const rows = buildBillSummaryRows(summaries);
      const summary = await upsertBillSummaryRows(supabase, rows);
      billSummaryProcessedCount += summary.attemptedCount;
      billSummaryUpsertedCount += summary.upsertedCount;
    }

    return json({
      freshestVotedOn,
      fetchedCount: houseVotes.length,
      processedCount,
      insertedCount,
      duplicateCount: processedCount - insertedCount,
      skippedRollCalls,
      syncedBillTypeCount: billSummaryTargets.length,
      billSummaryProcessedCount,
      billSummaryUpsertedCount,
      firstStartDate: houseVotes[0]?.startDate ?? null,
    });
  } catch (error) {
    console.error(error);
    return json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      500,
    );
  }
});
