import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { json } from "../_shared/http.ts";

const CONGRESS_API_ORIGIN = "https://api.congress.gov";
const RETRYABLE_MEMBER_STATUSES = new Set([429, 500, 502, 503, 504]);
const NOTIFICATION_START_AT = "2026-09-15T04:00:00.000Z";
const BACKFILL_PAGE_SIZE = 1000;
const MAX_BACKFILL_OUTBOX_ROWS = 10_000;
const MAX_BACKFILL_BILLS = 100;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  chamber: string;
  congress_number: number;
  voted_on: string;
  vote: string;
  member_id: string;
};

type OutboxRow = {
  sync_run_id: string;
  member_id: string;
  chamber: string;
  congress_number: number;
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
  updateDate?: string;
};

type BillSummaryRow = {
  number: number;
  bill_type: string;
  title: string;
  summary: string;
};

type CongressBillSummary = {
  text?: string;
  updateDate?: string;
  actionDate?: string;
};

type PendingNotificationVote = {
  member_id: string;
  chamber: string;
  congress_number: number;
  legislation_type: string | null;
  legislation_number: number | null;
  voted_on: string | null;
};

type NotificationUser = {
  state: string;
  district: number | null;
};

type NotificationRep = {
  bioguideid: string;
  chamber: string | null;
  state: string;
  congressionaldistrict: number | null;
  is_current_member: boolean | null;
};

type ExistingBillInfo = {
  title: string | null;
  summary: string | null;
};

type RollCallSummaryRow = {
  legislation_number: number;
  legislation_type: string;
  session_number: number;
  roll_call_number: number;
  chamber: string;
  congress_number: number;
  voted_on: string;
  result: string;
  yes_count: number;
  no_count: number;
  not_voting_count: number;
};

type ExistingOutboxRow = {
  member_id: string;
  chamber: string;
  congress_number: number;
  legislation_type: string;
  legislation_number: number;
  session_number: number;
  roll_call_number: number;
};

function hasServiceRoleAuthorization(request: Request) {
  const match = request.headers.get("authorization")?.trim().match(
    /^Bearer\s+(\S+)$/i,
  );
  const token = match?.[1];
  if (!token) return false;

  const payloadSegment = token.split(".")[1];
  if (!payloadSegment) return false;
  const base64 = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
  const paddedBase64 = base64 + "=".repeat((4 - base64.length % 4) % 4);

  try {
    const payload = JSON.parse(atob(paddedBase64));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

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
    | "chamber"
    | "congress_number"
    | "legislation_type"
    | "legislationnumber"
    | "session_number"
    | "roll_call_number"
  >,
) {
  return [
    String(row.member_id).trim(),
    String(row.chamber).trim(),
    Number(row.congress_number),
    String(row.legislation_type).trim().toLowerCase(),
    Number(row.legislationnumber),
    Number(row.session_number),
    Number(row.roll_call_number),
  ].join(":");
}

function getExistingOutboxKey(row: ExistingOutboxRow) {
  return [
    String(row.member_id).trim(),
    String(row.chamber).trim(),
    Number(row.congress_number),
    String(row.legislation_type).trim().toLowerCase(),
    Number(row.legislation_number),
    Number(row.session_number),
    Number(row.roll_call_number),
  ].join(":");
}

function getVoteScopeKey(scope: {
  chamber: string;
  congress_number: number;
  legislation_type: string;
  legislation_number: number;
  session_number: number;
  roll_call_number: number;
}) {
  return [
    String(scope.chamber).trim(),
    Number(scope.congress_number),
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
      chamber: string;
      congress_number: number;
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
      chamber: "House",
      congress_number: 119,
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

function getBillIdentityKey(
  congress: number,
  billType: string,
  number: number,
) {
  return `${Number(congress)}:${String(billType).trim().toLowerCase()}:${
    Number(number)
  }`;
}

function buildCongressBillUrl(
  path: string,
  apiKey: string,
) {
  const url = new URL(`/v3/${path}`, CONGRESS_API_ORIGIN);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");
  return url;
}

async function fetchCongressBillTitle(
  apiKey: string,
  congress: number,
  billType: string,
  number: number,
) {
  const url = buildCongressBillUrl(
    `bill/${congress}/${billType}/${number}`,
    apiKey,
  );
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `Congress bill lookup failed ${response.status} for ${billType} ${number}`,
    );
  }
  const payload = await response.json();
  const title = String(payload?.bill?.title ?? "").trim();
  return title || null;
}

async function fetchCongressBillSummary(
  apiKey: string,
  congress: number,
  billType: string,
  number: number,
) {
  const url = buildCongressBillUrl(
    `bill/${congress}/${billType}/${number}/summaries`,
    apiKey,
  );
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `Congress summary lookup failed ${response.status} for ${billType} ${number}`,
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

async function fetchPagedRows<T>(
  readPage: (
    from: number,
    to: number,
  ) => Promise<{ data: T[] | null; error: { message: string } | null }>,
  maxRows: number,
) {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += BACKFILL_PAGE_SIZE) {
    const to = Math.min(from + BACKFILL_PAGE_SIZE - 1, maxRows - 1);
    const { data, error } = await readPage(from, to);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < to - from + 1) break;
  }
  return rows;
}

async function loadPendingNotificationVotes(supabase: SupabaseClient) {
  const rows = await fetchPagedRows<PendingNotificationVote>(
    (from, to) =>
      supabase
        .from("vote_notification_outbox")
        .select(
          "member_id,chamber,congress_number,legislation_type,legislation_number,voted_on",
        )
        .is("processed_at", null)
        .gte("voted_on", NOTIFICATION_START_AT)
        .order("voted_on", { ascending: true })
        .range(from, to),
    MAX_BACKFILL_OUTBOX_ROWS,
  );
  return rows;
}

async function loadBackfillBillKeys(
  supabase: SupabaseClient,
  pendingVotes: PendingNotificationVote[],
) {
  const users = await fetchPagedRows<NotificationUser>(
    (from, to) =>
      supabase
        .from("users")
        .select("state,district")
        .eq("notifications_enabled", true)
        .not("state", "is", null)
        .range(from, to),
    10_000,
  );
  const memberIds = [...new Set(pendingVotes.map((row) => row.member_id))];
  const reps: NotificationRep[] = [];
  for (let index = 0; index < memberIds.length; index += 500) {
    const batch = memberIds.slice(index, index + 500);
    const rows = await fetchPagedRows<NotificationRep>(
      (from, to) =>
        supabase
          .from("reps")
          .select(
            "bioguideid,chamber,state,congressionaldistrict,is_current_member",
          )
          .in("bioguideid", batch)
          .range(from, to),
      1000,
    );
    reps.push(...rows);
  }
  const repsById = new Map(reps.map((rep) => [rep.bioguideid, rep]));
  const targetedRows = pendingVotes.filter((row) => {
    const rep = repsById.get(row.member_id);
    if (!rep || rep.is_current_member === false) return false;
    return users.some((user) => {
      if (
        String(user.state).trim().toLowerCase() !==
          String(rep.state).trim().toLowerCase()
      ) {
        return false;
      }
      const repChamber = String(rep.chamber ?? "").trim().toLowerCase();
      if (row.chamber === "House") {
        return repChamber.includes("house") &&
          user.district != null && rep.congressionaldistrict != null &&
          Number(user.district) === Number(rep.congressionaldistrict);
      }
      return row.chamber === "Senate" && repChamber.includes("senate");
    });
  });
  const billsByKey = new Map<string, {
    congress: number;
    billType: string;
    number: number;
  }>();
  for (const row of targetedRows) {
    const billType = String(row.legislation_type ?? "").trim().toLowerCase();
    const number = Number(row.legislation_number);
    if (!billType || !Number.isSafeInteger(number) || number < 1) continue;
    const key = getBillIdentityKey(row.congress_number, billType, number);
    billsByKey.set(key, { congress: row.congress_number, billType, number });
  }
  return [...billsByKey.values()];
}

async function backfillOneBill(
  supabase: SupabaseClient,
  apiKey: string,
  bill: { congress: number; billType: string; number: number },
) {
  const { data, error } = await supabase.from("bills")
    .select("title,summary")
    .eq("bill_type", bill.billType)
    .eq("number", bill.number)
    .limit(1);
  if (error) throw error;
  const existing = (data?.[0] ?? null) as ExistingBillInfo | null;
  const needsTitle = !existing?.title?.trim();
  const needsSummary = !existing?.summary?.trim();
  if (!needsTitle && !needsSummary) {
    return { changed: false, summaryFound: true };
  }

  const [officialTitle, officialSummary] = await Promise.all([
    needsTitle
      ? fetchCongressBillTitle(
        apiKey,
        bill.congress,
        bill.billType,
        bill.number,
      )
      : Promise.resolve(existing?.title?.trim() || null),
    needsSummary
      ? fetchCongressBillSummary(
        apiKey,
        bill.congress,
        bill.billType,
        bill.number,
      )
      : Promise.resolve(existing?.summary?.trim() || null),
  ]);
  const title = officialTitle ?? existing?.title?.trim() ?? "";
  if (!title) {
    throw new Error(
      `Congress.gov did not return a title for ${bill.billType} ${bill.number}`,
    );
  }

  if (existing) {
    const update: Record<string, string> = {};
    if (needsTitle) update.title = title;
    if (needsSummary && officialSummary) update.summary = officialSummary;
    if (Object.keys(update).length > 0) {
      const { error: updateError } = await supabase.from("bills").update(update)
        .eq("bill_type", bill.billType).eq("number", bill.number);
      if (updateError) throw updateError;
    }
    return {
      changed: Object.keys(update).length > 0,
      summaryFound: Boolean(officialSummary || existing.summary?.trim()),
    };
  }

  const { error: insertError } = await supabase.from("bills").upsert({
    bill_type: bill.billType,
    number: bill.number,
    title,
    summary: officialSummary ?? "",
  }, {
    onConflict: "bill_type,number",
    ignoreDuplicates: true,
    defaultToNull: false,
  });
  if (insertError) throw insertError;
  return { changed: true, summaryFound: Boolean(officialSummary) };
}

async function runPendingBillBackfill(
  supabase: SupabaseClient,
  apiKey: string,
) {
  const pendingVotes = await loadPendingNotificationVotes(supabase);
  const bills = await loadBackfillBillKeys(supabase, pendingVotes);
  const selected = bills.slice(0, MAX_BACKFILL_BILLS);
  const failures: Array<{ billType: string; number: number; error: string }> =
    [];
  let changedBillCount = 0;
  let officialSummaryCount = 0;
  let noOfficialSummaryCount = 0;
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(4, selected.length) },
    async () => {
      while (nextIndex < selected.length) {
        const bill = selected[nextIndex++];
        try {
          const result = await backfillOneBill(supabase, apiKey, bill);
          if (result.changed) changedBillCount += 1;
          if (result.summaryFound) officialSummaryCount += 1;
          else noOfficialSummaryCount += 1;
        } catch (error) {
          failures.push({
            billType: bill.billType,
            number: bill.number,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
  );
  await Promise.all(workers);

  return {
    mode: "backfill-pending-bill-data",
    cutoffInclusive: NOTIFICATION_START_AT,
    pendingVoteCount: pendingVotes.length,
    matchedBillCount: bills.length,
    processedBillCount: selected.length,
    changedBillCount,
    officialSummaryCount,
    noOfficialSummaryCount,
    hasMoreBills: bills.length > selected.length,
    failures,
  };
}

async function ensureHouseBillTitles(
  supabase: SupabaseClient,
  apiKey: string,
  houseVotes: HouseVote[],
) {
  const billsByKey = new Map<string, { billType: string; number: number }>();
  for (const vote of houseVotes) {
    const billType = String(vote.legislationType ?? "").trim().toLowerCase();
    const number = Number(vote.legislationNumber);
    if (!billType || !Number.isSafeInteger(number) || number < 1) continue;
    billsByKey.set(`${billType}:${number}`, { billType, number });
  }
  const bills = [...billsByKey.values()];
  if (bills.length === 0) return { checkedCount: 0, insertedCount: 0 };

  const types = [...new Set(bills.map((bill) => bill.billType))];
  const numbers = [...new Set(bills.map((bill) => bill.number))];
  const { data, error } = await supabase.from("bills")
    .select("bill_type,number")
    .in("bill_type", types)
    .in("number", numbers)
    .range(0, 999);
  if (error) throw error;
  const existingKeys = new Set(
    (data ?? []).map((bill) =>
      `${String(bill.bill_type).toLowerCase()}:${Number(bill.number)}`
    ),
  );
  const missing = bills.filter((bill) =>
    !existingKeys.has(`${bill.billType}:${bill.number}`)
  );
  let insertedCount = 0;
  for (let index = 0; index < missing.length; index += 4) {
    const batch = missing.slice(index, index + 4);
    const rows = await Promise.all(batch.map(async (bill) => {
      try {
        const title = await fetchCongressBillTitle(
          apiKey,
          119,
          bill.billType,
          bill.number,
        );
        return title
          ? {
            bill_type: bill.billType,
            number: bill.number,
            title,
            summary: "",
          }
          : null;
      } catch (error) {
        console.warn(
          `[sync-votes] bill title lookup deferred for ${bill.billType} ${bill.number}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return null;
      }
    }));
    const rowsToInsert = rows.filter((row) => row !== null);
    if (rowsToInsert.length === 0) continue;
    const { data: inserted, error: insertError } = await supabase.from("bills")
      .upsert(rowsToInsert, {
        onConflict: "bill_type,number",
        ignoreDuplicates: true,
        defaultToNull: false,
      })
      .select("number");
    if (insertError) throw insertError;
    insertedCount += inserted?.length ?? 0;
  }
  return { checkedCount: bills.length, insertedCount };
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
      const shouldRetry = RETRYABLE_MEMBER_STATUSES.has(response.status) &&
        attempt < maxAttempts;

      if (!shouldRetry) {
        throw lastError;
      }

      console.warn(
        `[sync-votes] retry ${attempt}/${
          maxAttempts - 1
        } for session ${sessionNumber} roll call ${rollCallNumber} after status ${response.status}`,
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
      chamber: "House",
      congress_number: 119,
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
    chamber: "House",
    congress_number: 119,
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
      onConflict:
        "member_id,chamber,congress_number,session_number,roll_call_number",
      ignoreDuplicates: true,
      defaultToNull: false,
    })
    .select(
      "member_id, legislationnumber, legislation_type, session_number, roll_call_number, chamber, congress_number, voted_on, vote",
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
      onConflict: "chamber,congress_number,session_number,roll_call_number",
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
  const rowsByBill = new Map<
    string,
    { row: BillSummaryRow; updatedAt: number }
  >();

  for (const summary of summaries) {
    if (
      !summary?.bill?.number ||
      !summary?.bill?.type ||
      !summary?.bill?.title ||
      typeof summary?.text !== "string" ||
      !hasNonEmptyText(summary.text)
    ) {
      continue;
    }

    const row = {
      number: Number(summary.bill.number),
      bill_type: String(summary.bill.type).toLowerCase(),
      title: summary.bill.title,
      summary: summary.text.trim(),
    } satisfies BillSummaryRow;
    const key = getBillKey(row.bill_type, row.number);
    const parsedUpdateDate = Date.parse(summary.updateDate ?? "");
    const updatedAt = Number.isFinite(parsedUpdateDate) ? parsedUpdateDate : 0;
    const existing = rowsByBill.get(key);

    if (!existing || updatedAt > existing.updatedAt) {
      rowsByBill.set(key, { row, updatedAt });
    }
  }

  return Array.from(rowsByBill.values(), ({ row }) => row);
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
    chamber: row.chamber,
    congress_number: row.congress_number,
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

  const billTypes = [
    ...new Set(voteScopes.map((scope) => scope.legislation_type)),
  ];
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
      "member_id, legislationnumber, legislation_type, session_number, roll_call_number, chamber, congress_number, voted_on, vote",
    )
    .eq("chamber", "House")
    .eq("congress_number", 119)
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
          chamber: row.chamber,
          congress_number: row.congress_number,
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
      "member_id, chamber, congress_number, legislation_type, legislation_number, session_number, roll_call_number",
    )
    .eq("chamber", "House")
    .eq("congress_number", 119)
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

  const requestBody = await req.json().catch(() => ({}));
  const backfillMode = requestBody?.mode === "backfill-pending-bill-data";

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const congressApiKey = Deno.env.get("CONGRESS_API_KEY");

  if (!supabaseUrl || !serviceRoleKey || !congressApiKey) {
    return json({ error: "Missing function secrets" }, 500);
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    if (backfillMode) {
      // Supabase verifies the JWT signature before invoking this function.
      if (!hasServiceRoleAuthorization(req)) {
        return json({
          error: "Backfill mode requires service-role authorization",
        }, 403);
      }
      const result = await runPendingBillBackfill(supabase, congressApiKey);
      return json(result, result.failures.length > 0 ? 500 : 200);
    }
    const syncRunId = crypto.randomUUID();

    const { data, error } = await supabase
      .from("member_voting_record")
      .select("voted_on")
      .eq("chamber", "House")
      .not("voted_on", "is", null)
      .order("voted_on", { ascending: false })
      .limit(1);

    if (error) {
      console.error(error);
      return json({ error: error.message }, 500);
    }

    const freshestVotedOn = data?.[0]?.voted_on ?? null;
    const houseVotes = await fetchHouseVotes(congressApiKey, freshestVotedOn);
    const houseBillTitleSummary = await ensureHouseBillTitles(
      supabase,
      congressApiKey,
      houseVotes,
    );
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
          `[sync-votes] skipping session ${vote.sessionNumber} roll call ${vote.rollCallNumber}: ${
            error instanceof Error ? error.message : "Unexpected error"
          }`,
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

    const summaryReadyQueueCandidates =
      await findSummaryReadyVotesMissingOutbox(
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
      checkedHouseBillCount: houseBillTitleSummary.checkedCount,
      insertedHouseBillTitleCount: houseBillTitleSummary.insertedCount,
    });
  } catch (error) {
    console.error(error);
    return json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      500,
    );
  }
});
