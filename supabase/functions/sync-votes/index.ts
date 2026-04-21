import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { json } from "../_shared/http.ts";

const CONGRESS_API_ORIGIN = "https://api.congress.gov";
const RETRYABLE_MEMBER_STATUSES = new Set([429, 500, 502, 503, 504]);
const wait = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

type SupabaseClient = ReturnType<typeof createClient>;

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

type HouseVotePartyTotal = {
  yeaTotal?: string | number;
  nayTotal?: string | number;
  notVotingTotal?: string | number;
};

type HouseVoteSummary = {
  result?: string;
  votePartyTotal?: HouseVotePartyTotal[];
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

type OutboxRow = {
  sync_run_id: string;
  member_id: string;
  legislation_type: string;
  legislation_number: number;
  session_number: number;
  roll_call_number: number;
  voted_on: string;
  vote: string;
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

type RollCallSummaryRow = {
  legislation_number: number;
  legislation_type: string;
  session_number: number;
  roll_call_number: number;
  voted_on: string;
  result: string;
  yes_count: number;
  no_count: number;
  not_voting_count: number;
};

type ExistingOutboxRow = {
  member_id: string;
  legislation_type: string;
  legislation_number: number;
  session_number: number;
  roll_call_number: number;
};

function toCongressDateTimeString(value: Date) {
  return value.toISOString().replace(".000Z", "Z");
}

function toCongressNextUrl(paginationNext: string, apiKey: string) {
  const next = new URL(paginationNext, CONGRESS_API_ORIGIN);
  next.searchParams.set("api_key", apiKey);
  next.searchParams.set("format", "json");
  return next.toString();
}

function countQueuedRepGroups(rows: Array<{ member_id: string }>) {
  const memberIds = new Set(
    rows
      .map((row) => String(row.member_id ?? "").trim())
      .filter(Boolean),
  );
  return memberIds.size;
}

function hasNonEmptyText(value: string | null | undefined) {
  return String(value ?? "").trim() !== "";
}

function getBillKey(billType: string, billNumber: number) {
  return `${String(billType).trim().toLowerCase()}:${Number(billNumber)}`;
}

function getNotificationKey(
  row: Pick<
    MemberVotingRecordRow,
    | "member_id"
    | "legislation_type"
    | "legislationnumber"
    | "session_number"
    | "roll_call_number"
  >,
) {
  return [
    String(row.member_id).trim(),
    String(row.legislation_type).trim().toLowerCase(),
    Number(row.legislationnumber),
    Number(row.session_number),
    Number(row.roll_call_number),
  ].join(":");
}

function getExistingOutboxKey(row: ExistingOutboxRow) {
  return [
    String(row.member_id).trim(),
    String(row.legislation_type).trim().toLowerCase(),
    Number(row.legislation_number),
    Number(row.session_number),
    Number(row.roll_call_number),
  ].join(":");
}

function getVoteScopeKey(scope: {
  legislation_type: string;
  legislation_number: number;
  session_number: number;
  roll_call_number: number;
}) {
  return [
    String(scope.legislation_type).trim().toLowerCase(),
    Number(scope.legislation_number),
    Number(scope.session_number),
    Number(scope.roll_call_number),
  ].join(":");
}

function buildHouseVoteScopes(houseVotes: HouseVote[]) {
  const scopedVotes = new Map<
    string,
    {
      legislation_type: string;
      legislation_number: number;
      session_number: number;
      roll_call_number: number;
    }
  >();

  for (const vote of houseVotes) {
    if (
      !vote.legislationNumber ||
      !vote.legislationType ||
      !vote.sessionNumber ||
      !vote.rollCallNumber
    ) {
      continue;
    }

    const scope = {
      legislation_type: String(vote.legislationType).trim().toLowerCase(),
      legislation_number: Number(vote.legislationNumber),
      session_number: Number(vote.sessionNumber),
      roll_call_number: Number(vote.rollCallNumber),
    };

    scopedVotes.set(getVoteScopeKey(scope), scope);
  }

  return [...scopedVotes.values()];
}

async function fetchHouseVotes(apiKey: string, fromDateTime: string | null) {
  const baseUrl = new URL("https://api.congress.gov/v3/house-vote/119");
  baseUrl.searchParams.set("limit", "250");
  baseUrl.searchParams.set("api_key", apiKey);
  baseUrl.searchParams.set("format", "json");

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
  baseUrl.searchParams.set("format", "json");

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
  baseUrl.searchParams.set("format", "json");

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

async function fetchRollCallSummary(
  apiKey: string,
  sessionNumber: string | number | undefined,
  rollCallNumber: string | number | undefined,
) {
  if (!sessionNumber || !rollCallNumber) {
    return null;
  }

  const url = new URL(
    `https://api.congress.gov/v3/house-vote/119/${sessionNumber}/${rollCallNumber}`,
  );
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");

  const response = await fetch(url);
  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `Congress house-vote summary fetch failed ${response.status} for ${url}: ${details}`,
    );
  }

  const data = await response.json();
  const vote: HouseVoteSummary | null = Array.isArray(data?.houseRollCallVote)
    ? (data.houseRollCallVote[0] ?? null)
    : (data?.houseRollCallVote ?? null);

  if (!vote?.result) {
    return null;
  }

  const totals = (vote.votePartyTotal ?? []).reduce(
    (acc, partyRow) => ({
      yes: acc.yes + Number(partyRow?.yeaTotal ?? 0),
      no: acc.no + Number(partyRow?.nayTotal ?? 0),
      notVoting: acc.notVoting + Number(partyRow?.notVotingTotal ?? 0),
    }),
    { yes: 0, no: 0, notVoting: 0 },
  );

  return {
    result: vote.result,
    totals,
  };
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

function buildRollCallSummaryRow(
  vote: HouseVote,
  summary:
    | {
        result: string;
        totals: { yes: number; no: number; notVoting: number };
      }
    | null,
) {
  if (
    !vote.legislationNumber ||
    !vote.legislationType ||
    !vote.startDate ||
    !summary?.result
  ) {
    return null;
  }

  return {
    legislation_number: Number(vote.legislationNumber),
    legislation_type: String(vote.legislationType).toLowerCase(),
    session_number: Number(vote.sessionNumber),
    roll_call_number: Number(vote.rollCallNumber),
    voted_on: vote.startDate,
    result: summary.result,
    yes_count: Number(summary.totals.yes ?? 0),
    no_count: Number(summary.totals.no ?? 0),
    not_voting_count: Number(summary.totals.notVoting ?? 0),
  } satisfies RollCallSummaryRow;
}

async function upsertRollCallRows(
  supabase: SupabaseClient,
  rows: MemberVotingRecordRow[],
) {
  if (rows.length === 0) {
    return {
      attemptedCount: 0,
      insertedCount: 0,
      insertedRows: [] as MemberVotingRecordRow[],
    };
  }

  const { data, error } = await supabase
    .from("member_voting_record")
    .upsert(rows, {
      onConflict: "member_id,session_number,roll_call_number",
      ignoreDuplicates: true,
      defaultToNull: false,
    })
    .select(
      "member_id, legislationnumber, legislation_type, session_number, roll_call_number, voted_on, vote",
    );

  if (error) {
    throw error;
  }

  return {
    attemptedCount: rows.length,
    insertedCount: data?.length ?? 0,
    insertedRows: (data ?? []) as MemberVotingRecordRow[],
  };
}

async function upsertRollCallSummaryRow(
  supabase: SupabaseClient,
  row: RollCallSummaryRow | null,
) {
  if (!row) {
    return { attemptedCount: 0, upsertedCount: 0 };
  }

  const { data, error } = await supabase
    .from("roll_call_summaries")
    .upsert(row, {
      onConflict: "session_number,roll_call_number",
      ignoreDuplicates: false,
      defaultToNull: false,
    })
    .select("session_number");

  if (error) {
    throw error;
  }

  return {
    attemptedCount: 1,
    upsertedCount: data?.length ?? 0,
  };
}

function buildBillSummaryRows(summaries: BillSummary[]) {
  return summaries
    .filter((summary) =>
      summary?.bill?.number &&
      summary?.bill?.type &&
      summary?.bill?.title &&
      typeof summary?.text === "string" &&
      hasNonEmptyText(summary.text)
    )
    .map((summary) => ({
      number: Number(summary.bill!.number),
      bill_type: String(summary.bill!.type).toLowerCase(),
      title: summary.bill!.title!,
      summary: summary.text!.trim(),
    }));
}

async function upsertBillSummaryRows(
  supabase: SupabaseClient,
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

async function enqueueVoteNotifications(
  supabase: SupabaseClient,
  syncRunId: string,
  queueRows: MemberVotingRecordRow[],
) {
  if (queueRows.length === 0) {
    return { queuedCount: 0, queuedRows: [] as MemberVotingRecordRow[] };
  }

  const payload: OutboxRow[] = queueRows.map((row) => ({
    sync_run_id: syncRunId,
    member_id: row.member_id,
    legislation_type: row.legislation_type,
    legislation_number: row.legislationnumber,
    session_number: row.session_number,
    roll_call_number: row.roll_call_number,
    voted_on: row.voted_on,
    vote: row.vote,
  }));

  const { data, error } = await supabase
    .from("vote_notification_outbox")
    .insert(payload)
    .select("member_id");

  if (error) {
    throw error;
  }

  return {
    queuedCount: data?.length ?? 0,
    queuedRows: queueRows,
  };
}

async function findSummaryReadyVotesMissingOutbox(
  supabase: SupabaseClient,
  houseVotes: HouseVote[],
) {
  const voteScopes = buildHouseVoteScopes(houseVotes);
  if (voteScopes.length === 0) {
    return [] as MemberVotingRecordRow[];
  }

  const billTypes = [...new Set(voteScopes.map((scope) => scope.legislation_type))];
  const billNumbers = [
    ...new Set(voteScopes.map((scope) => scope.legislation_number)),
  ];
  const sessionNumbers = [
    ...new Set(voteScopes.map((scope) => scope.session_number)),
  ];
  const rollCallNumbers = [
    ...new Set(voteScopes.map((scope) => scope.roll_call_number)),
  ];

  const { data: billData, error: billError } = await supabase
    .from("bills")
    .select("bill_type, number, summary")
    .in("bill_type", billTypes)
    .in("number", billNumbers);

  if (billError) {
    throw billError;
  }

  const summaryReadyBillKeys = new Set(
    ((billData ?? []) as BillSummaryRow[])
      .filter((row) => hasNonEmptyText(row.summary))
      .map((row) => getBillKey(row.bill_type, row.number)),
  );

  if (summaryReadyBillKeys.size === 0) {
    return [] as MemberVotingRecordRow[];
  }

  const summaryReadyScopeKeys = new Set(
    voteScopes
      .filter((scope) =>
        summaryReadyBillKeys.has(
          getBillKey(scope.legislation_type, scope.legislation_number),
        )
      )
      .map(getVoteScopeKey),
  );

  if (summaryReadyScopeKeys.size === 0) {
    return [] as MemberVotingRecordRow[];
  }

  const { data: memberVoteData, error: memberVoteError } = await supabase
    .from("member_voting_record")
    .select(
      "member_id, legislationnumber, legislation_type, session_number, roll_call_number, voted_on, vote",
    )
    .in("legislation_type", billTypes)
    .in("legislationnumber", billNumbers)
    .in("session_number", sessionNumbers)
    .in("roll_call_number", rollCallNumbers);

  if (memberVoteError) {
    throw memberVoteError;
  }

  const candidateRows = ((memberVoteData ?? []) as MemberVotingRecordRow[])
    .filter((row) =>
      summaryReadyScopeKeys.has(
        getVoteScopeKey({
          legislation_type: row.legislation_type,
          legislation_number: row.legislationnumber,
          session_number: row.session_number,
          roll_call_number: row.roll_call_number,
        }),
      )
    )
    .sort((a, b) => {
      if (a.session_number !== b.session_number) {
        return a.session_number - b.session_number;
      }
      if (a.roll_call_number !== b.roll_call_number) {
        return a.roll_call_number - b.roll_call_number;
      }
      return a.member_id.localeCompare(b.member_id);
    });

  if (candidateRows.length === 0) {
    return [];
  }

  const memberIds = [...new Set(candidateRows.map((row) => row.member_id))];

  const { data: outboxData, error: outboxError } = await supabase
    .from("vote_notification_outbox")
    .select(
      "member_id, legislation_type, legislation_number, session_number, roll_call_number",
    )
    .in("member_id", memberIds)
    .in("legislation_type", billTypes)
    .in("legislation_number", billNumbers)
    .in("session_number", sessionNumbers)
    .in("roll_call_number", rollCallNumbers);

  if (outboxError) {
    throw outboxError;
  }

  const existingOutboxKeys = new Set(
    ((outboxData ?? []) as ExistingOutboxRow[]).map(getExistingOutboxKey),
  );

  return candidateRows.filter(
    (row) => !existingOutboxKeys.has(getNotificationKey(row)),
  );
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
    const syncRunId = crypto.randomUUID();

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
    let insertedVoteQueuedCount = 0;
    let summaryReadyQueuedVoteCount = 0;
    let queuedVoteCount = 0;
    const queuedRows: MemberVotingRecordRow[] = [];
    let skippedRollCalls = 0;
    let rollCallSummaryProcessedCount = 0;
    let rollCallSummaryUpsertedCount = 0;
    let billSummaryProcessedCount = 0;
    let billSummaryUpsertedCount = 0;

    for (const vote of houseVotes) {
      let members: HouseVoteRecord[] = [];
      let rollCallSummary:
        | {
            result: string;
            totals: { yes: number; no: number; notVoting: number };
          }
        | null = null;

      try {
        members =
          Array.isArray(vote.votingRecord) && vote.votingRecord.length > 0
            ? vote.votingRecord
            : await fetchRollCallMembersWithRetry(
                congressApiKey,
                vote.sessionNumber,
                vote.rollCallNumber,
              );
        rollCallSummary = await fetchRollCallSummary(
          congressApiKey,
          vote.sessionNumber,
          vote.rollCallNumber,
        );
      } catch (error) {
        skippedRollCalls += 1;
        console.warn(
          `[sync-votes] skipping session ${vote.sessionNumber} roll call ${vote.rollCallNumber}: ${error instanceof Error ? error.message : "Unexpected error"}`,
        );
        continue;
      }

      const rollCallSummaryRow = buildRollCallSummaryRow(vote, rollCallSummary);
      const rollCallSummaryResult = await upsertRollCallSummaryRow(
        supabase,
        rollCallSummaryRow,
      );
      rollCallSummaryProcessedCount += rollCallSummaryResult.attemptedCount;
      rollCallSummaryUpsertedCount += rollCallSummaryResult.upsertedCount;

      const rows = buildRollCallRows(vote, members);
      if (rows.length === 0) {
        skippedRollCalls += 1;
        continue;
      }

      const summary = await upsertRollCallRows(supabase, rows);
      const queueSummary = await enqueueVoteNotifications(
        supabase,
        syncRunId,
        summary.insertedRows,
      );

      processedCount += summary.attemptedCount;
      insertedCount += summary.insertedCount;
      insertedVoteQueuedCount += queueSummary.queuedCount;
      queuedVoteCount += queueSummary.queuedCount;
      queuedRows.push(...queueSummary.queuedRows);
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

    const summaryReadyQueueCandidates = await findSummaryReadyVotesMissingOutbox(
      supabase,
      houseVotes,
    );
    const summaryReadyQueueSummary = await enqueueVoteNotifications(
      supabase,
      syncRunId,
      summaryReadyQueueCandidates,
    );
    summaryReadyQueuedVoteCount = summaryReadyQueueSummary.queuedCount;
    queuedVoteCount += summaryReadyQueueSummary.queuedCount;
    queuedRows.push(...summaryReadyQueueSummary.queuedRows);

    return json({
      syncRunId,
      freshestVotedOn,
      fetchedCount: houseVotes.length,
      processedCount,
      insertedCount,
      duplicateCount: processedCount - insertedCount,
      insertedVoteQueuedCount,
      summaryReadyQueuedVoteCount,
      queuedVoteCount,
      queuedRepGroupCount: countQueuedRepGroups(queuedRows),
      skippedRollCalls,
      rollCallSummaryProcessedCount,
      rollCallSummaryUpsertedCount,
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
