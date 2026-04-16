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

const BILL_TYPE_LABELS: Record<string, string> = {
  hr: "H.R.",
  hres: "H.Res.",
  hjres: "H.J.Res.",
  hconres: "H.Con.Res.",
  s: "S.",
  sres: "S.Res.",
  sjres: "S.J.Res.",
  sconres: "S.Con.Res.",
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getRepLastName(repName = "") {
  const parts = String(repName).trim().split(/\s+/).filter(Boolean);
  return parts.at(-1) ?? "Representative";
}

function getBillLabel(vote: {
  legislation_type: string;
  legislationnumber: number;
}) {
  const typeKey = String(vote.legislation_type ?? "").trim().toLowerCase();
  const prefix = BILL_TYPE_LABELS[typeKey] ?? String(typeKey).toUpperCase();
  return `${prefix} ${vote.legislationnumber}`;
}

function getVoteDisplayTitle(vote: {
  legislation_type: string;
  legislationnumber: number;
  billTitle?: string | null;
}) {
  const billLabel = getBillLabel(vote);
  const typeKey = String(vote.legislation_type ?? "").trim().toLowerCase();
  if (typeKey.includes("res")) return billLabel;
  const title = String(vote.billTitle ?? "").trim();
  return title || billLabel;
}

function getVotePillStyles(voteValue: string) {
  const normalizedVote = String(voteValue ?? "").trim();
  if (normalizedVote === "Yea" || normalizedVote === "Aye") {
    return {
      text: "#166534",
      background: "#ecfdf3",
      border: "#bbf7d0",
    };
  }
  if (normalizedVote === "Nay" || normalizedVote === "No") {
    return {
      text: "#b91c1c",
      background: "#fef2f2",
      border: "#fecdd3",
    };
  }
  return {
    text: "#374151",
    background: "#f3f4f6",
    border: "#e5e7eb",
  };
}

function buildVotePillHtml(voteValue: string) {
  const styles = getVotePillStyles(voteValue);
  return `<span style="display: inline-block; padding: 2px 8px; border-radius: 999px; border: 1px solid ${styles.border}; background: ${styles.background}; color: ${styles.text}; font-size: 13px; font-weight: 700; line-height: 1.4; white-space: nowrap;">${escapeHtml(voteValue)}</span>`;
}

function buildRepVoteBatchEmail({
  firstName,
  repName,
  votes,
  appOrigin,
}: {
  firstName?: string | null;
  repName: string;
  votes: Array<{
    legislation_type: string;
    legislationnumber: number;
    vote: string;
    billTitle?: string | null;
  }>;
  appOrigin: string;
}) {
  if (!Array.isArray(votes) || votes.length === 0) {
    throw new Error("buildRepVoteBatchEmail requires at least one vote");
  }

  const repLastName = getRepLastName(repName);
  const safeRepLastName = escapeHtml(repLastName);
  const safeFirstName = escapeHtml(firstName || "there");
  const feedUrl = new URL("/feed", appOrigin).toString();
  const siteUrl = new URL("/", appOrigin).toString();
  const subject = `Here are Rep. ${repLastName}'s latest votes`;

  const itemsHtml = votes
    .map((vote) => {
      const displayTitle = getVoteDisplayTitle(vote);
      const billUrl = new URL(
        `/bill/${String(vote.legislation_type).trim().toLowerCase()}/${vote.legislationnumber}`,
        appOrigin,
      ).toString();
      const votePillHtml = buildVotePillHtml(vote.vote);
      return `<li style="margin: 0 0 12px;">Rep. ${safeRepLastName} voted ${votePillHtml} on <a href="${billUrl}" style="color: #1d4ed8; text-decoration: underline;">${escapeHtml(displayTitle)}</a></li>`;
    })
    .join("");

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; line-height: 1.6; color: #0f172a; background: #ffffff;">
      <p>Hi ${safeFirstName},</p>
      <p>Here are Rep. ${safeRepLastName}'s latest votes,</p>
      <ul style="padding-left: 20px; margin: 0 0 20px;">
        ${itemsHtml}
      </ul>
      <p>Let Rep. ${safeRepLastName} know how you feel about their votes!</p>
      <p style="margin: 24px 0;">
        <a href="${feedUrl}" style="display: inline-block; padding: 12px 18px; border-radius: 10px; background: #1d4ed8; color: #ffffff; text-decoration: none; font-weight: 700;">Go to VoteFeed</a>
      </p>
      <p style="margin-top: 24px;">Stay Civic,<br /><a href="${siteUrl}" style="color: #1d4ed8; text-decoration: underline;">VoteFeed.org</a></p>
    </div>
  `.trim();

  const text = [
    `Hi ${firstName || "there"},`,
    "",
    `Here are Rep. ${repLastName}'s latest votes,`,
    "",
    ...votes.map((vote) => {
      const displayTitle = getVoteDisplayTitle(vote);
      const billUrl = new URL(
        `/bill/${String(vote.legislation_type).trim().toLowerCase()}/${vote.legislationnumber}`,
        appOrigin,
      ).toString();
      return `- Rep. ${repLastName} voted ${vote.vote} on ${displayTitle} (${billUrl})`;
    }),
    "",
    `Let Rep. ${repLastName} know how you feel about their votes!`,
    `Go to VoteFeed: ${feedUrl}`,
    "",
    "Stay Civic,",
    `VoteFeed.org (${siteUrl})`,
  ].join("\n");

  return { subject, html, text };
}

async function sendEmail(
  resendApiKey: string,
  {
    from,
    to,
    subject,
    html,
    text,
  }: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
  },
) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Resend send failed ${response.status}: ${details}`);
  }

  return await response.json();
}

function groupInsertedVotesByRep(insertedRows: MemberVotingRecordRow[]) {
  const grouped = new Map<string, MemberVotingRecordRow[]>();

  for (const row of insertedRows) {
    const memberId = String(row.member_id ?? "").trim();
    if (!memberId) continue;
    if (!grouped.has(memberId)) grouped.set(memberId, []);
    grouped.get(memberId)!.push(row);
  }

  return Array.from(grouped, ([memberId, votes]) => ({
    memberId,
    votes: votes.sort((a, b) => {
      if (a.session_number !== b.session_number) {
        return b.session_number - a.session_number;
      }
      return b.roll_call_number - a.roll_call_number;
    }),
  }));
}

async function findRepByBioguideId(
  supabase: ReturnType<typeof createClient>,
  bioguideId: string,
) {
  const { data, error } = await supabase
    .from("reps")
    .select("bioguideid, full_name, state, congressionaldistrict")
    .eq("bioguideid", bioguideId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function findUsersToNotifyForRepVote(
  supabase: ReturnType<typeof createClient>,
  state: string,
  district: number,
  sessionNumber: number,
  rollCallNumber: number,
) {
  const { data, error } = await supabase
    .from("users")
    .select(
      "id, email, first_name, last_name, state, district, last_notified_session_number, last_notified_roll_call_number",
    )
    .eq("notifications_enabled", true)
    .not("email", "is", null)
    .eq("state", state)
    .eq("district", district);

  if (error) throw error;

  return (data ?? []).filter((user) => {
    const lastSession = user.last_notified_session_number;
    const lastRollCall = user.last_notified_roll_call_number;
    return (
      lastSession == null ||
      lastRollCall == null ||
      lastSession < sessionNumber ||
      (lastSession === sessionNumber && lastRollCall < rollCallNumber)
    );
  });
}

async function findBillByTypeAndNumber(
  supabase: ReturnType<typeof createClient>,
  billType: string,
  billNumber: number,
) {
  const { data, error } = await supabase
    .from("bills")
    .select("title, legislation_url")
    .eq("bill_type", billType)
    .eq("number", billNumber)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function markUserVoteNotificationSent(
  supabase: ReturnType<typeof createClient>,
  userId: number,
  sessionNumber: number,
  rollCallNumber: number,
) {
  const { error } = await supabase
    .from("users")
    .update({
      last_notified_session_number: sessionNumber,
      last_notified_roll_call_number: rollCallNumber,
    })
    .eq("id", userId);

  if (error) throw error;
}

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
  next.searchParams.set("format", "json");
  return next.toString();
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
  supabase: ReturnType<typeof createClient>,
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
  supabase: ReturnType<typeof createClient>,
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
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const resendFromEmail = Deno.env.get("RESEND_FROM_EMAIL");
  const appOrigin = Deno.env.get("APP_ORIGIN");

  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    !congressApiKey ||
    !resendApiKey ||
    !resendFromEmail ||
    !appOrigin
  ) {
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
    const insertedRows: MemberVotingRecordRow[] = [];
    let skippedRollCalls = 0;
    let rollCallSummaryProcessedCount = 0;
    let rollCallSummaryUpsertedCount = 0;
    let billSummaryProcessedCount = 0;
    let billSummaryUpsertedCount = 0;

    for (const vote of houseVotes) {
      try {
        const members =
          Array.isArray(vote.votingRecord) && vote.votingRecord.length > 0
            ? vote.votingRecord
            : await fetchRollCallMembersWithRetry(
                congressApiKey,
                vote.sessionNumber,
                vote.rollCallNumber,
              );
        const rollCallSummary = await fetchRollCallSummary(
          congressApiKey,
          vote.sessionNumber,
          vote.rollCallNumber,
        );
        const rollCallSummaryRow = buildRollCallSummaryRow(
          vote,
          rollCallSummary,
        );
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
        processedCount += summary.attemptedCount;
        insertedCount += summary.insertedCount;
        insertedRows.push(...summary.insertedRows);
      } catch (error) {
        skippedRollCalls += 1;
        console.warn(
          `[sync-votes] skipping session ${vote.sessionNumber} roll call ${vote.rollCallNumber}: ${error instanceof Error ? error.message : "Unexpected error"}`,
        );
      }
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

    const groupedVotesByRep = groupInsertedVotesByRep(insertedRows);
    const repNotificationTargets = [];
    let sentEmailCount = 0;

    for (const batch of groupedVotesByRep) {
      const rep = await findRepByBioguideId(supabase, batch.memberId);
      if (!rep || rep.congressionaldistrict == null) {
        console.warn(
          `[sync-votes] missing rep or district for member ${batch.memberId}`,
        );
        continue;
      }

      const enrichedVotes = await Promise.all(
        batch.votes.map(async (vote) => {
          const bill = await findBillByTypeAndNumber(
            supabase,
            vote.legislation_type,
            vote.legislationnumber,
          );

          return {
            ...vote,
            billTitle:
              bill?.title ??
              `${String(vote.legislation_type).toUpperCase()} ${vote.legislationnumber}`,
            legislationUrl: bill?.legislation_url ?? null,
          };
        }),
      );

      const newestVote = enrichedVotes[0];
      const users = await findUsersToNotifyForRepVote(
        supabase,
        rep.state,
        rep.congressionaldistrict,
        newestVote.session_number,
        newestVote.roll_call_number,
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

    for (const target of repNotificationTargets) {
      if (target.users.length === 0) continue;
      const newestVote = target.votes[0];

      for (const user of target.users) {
        const email = buildRepVoteBatchEmail({
          firstName: user.first_name,
          repName: target.repName,
          votes: target.votes,
          appOrigin,
        });

        await sendEmail(resendApiKey, {
          from: resendFromEmail,
          to: user.email,
          subject: email.subject,
          html: email.html,
          text: email.text,
        });

        await markUserVoteNotificationSent(
          supabase,
          user.id,
          newestVote.session_number,
          newestVote.roll_call_number,
        );

        sentEmailCount += 1;
      }
    }

    return json({
      freshestVotedOn,
      fetchedCount: houseVotes.length,
      processedCount,
      insertedCount,
      duplicateCount: processedCount - insertedCount,
      insertedRowCount: insertedRows.length,
      groupedRepCount: groupedVotesByRep.length,
      repNotificationTargetCount: repNotificationTargets.length,
      sentEmailCount,
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
