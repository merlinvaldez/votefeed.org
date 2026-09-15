import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { json } from "../_shared/http.ts";

const MAX_GROUPS_PER_INVOCATION = 500;
const MAX_EMAILS_PER_INVOCATION = 100;
const MAX_RUNTIME_MS = 100_000;
const MAX_FAILURE_ATTEMPTS = 5;
const PENDING_OUTBOX_PAGE_SIZE = 1000;
const MAX_PENDING_OUTBOX_ROWS_PER_INVOCATION = 10_000;
const RESEND_MAX_SEND_ATTEMPTS = 3;
const RESEND_MIN_SEND_INTERVAL_MS = 250;
const RESEND_RETRY_BASE_MS = 1_000;
const MAX_AI_SUMMARIES_PER_INVOCATION = 10;
const DEFAULT_OPENAI_MODEL = "gpt-5.4";
const NOTIFICATION_START_DATE = "2026-09-10T00:00:00.000Z";
const OUTBOX_UPDATE_BATCH_SIZE = 100;

const wait = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unexpected error";
  }
}

type SupabaseClient = ReturnType<typeof createClient>;

type OutboxRow = {
  id: string;
  sync_run_id: string;
  member_id: string;
  legislation_type: string;
  legislation_number: number;
  session_number: number;
  roll_call_number: number;
  voted_on: string | null;
  vote: string;
  created_at: string;
  processed_at: string | null;
  attempt_count: number;
  last_error: string | null;
};

type OutboxGroup = {
  syncRunId: string;
  memberId: string;
  rows: OutboxRow[];
};

type RepRow = {
  bioguideid: string;
  full_name: string;
  chamber: string | null;
  state: string;
  congressionaldistrict: number | null;
  is_current_member: boolean;
};

type UserRow = {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  state: string;
  district: number;
  last_notified_session_number: number | null;
  last_notified_roll_call_number: number | null;
};

type BillRow = {
  bill_type: string;
  number: number;
  title: string | null;
  summary: string | null;
  aisummary: string | null;
  legislation_url: string | null;
};

type EnrichedVote = {
  outboxId: string | null;
  legislation_type: string;
  legislation_number: number;
  session_number: number;
  roll_call_number: number;
  voted_on: string | null;
  vote: string;
  billTitle: string;
  billSummary: string | null;
  aiSummary: string | null;
  legislationUrl: string | null;
};

type LatestVoteRow = {
  id: number;
  member_id: string;
  legislationnumber: number;
  legislation_type: string;
  session_number: number;
  roll_call_number: number;
  voted_on: string | null;
  vote: string;
};

type BillLookupKey = {
  legislation_type: string;
  legislation_number: number;
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
  const normalized = String(repName).trim();
  if (!normalized) return "Representative";
  if (normalized.includes(",")) {
    return normalized.split(",")[0].trim() || "Representative";
  }
  const parts = normalized.split(/\s+/).filter(Boolean);
  return parts.at(-1) ?? "Representative";
}

function getBillLabel(vote: {
  legislation_type: string;
  legislation_number: number;
}) {
  const typeKey = String(vote.legislation_type ?? "").trim().toLowerCase();
  const prefix = BILL_TYPE_LABELS[typeKey] ?? String(typeKey).toUpperCase();
  return `${prefix} ${vote.legislation_number}`;
}

function getLegislationTypeLabel(legislationType: string) {
  const typeKey = String(legislationType ?? "").trim().toLowerCase();
  if (typeKey === "hr" || typeKey === "s") return "a bill";
  if (typeKey === "hres" || typeKey === "sres") return "a resolution";
  if (typeKey === "hjres" || typeKey === "sjres") {
    return "a joint resolution";
  }
  if (typeKey === "hconres" || typeKey === "sconres") {
    return "a concurrent resolution";
  }
  return "legislation";
}

function normalizeQuickSummary(summary: string | null) {
  const normalized = String(summary ?? "")
    .replace(/^\s*to\s+/i, "")
    .replace(/[.!?]+\s*$/, "")
    .trim();
  return normalized
    ? `${normalized.charAt(0).toLowerCase()}${normalized.slice(1)}`
    : "";
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

function buildVoteSentenceHtml(repLastName: string, vote: EnrichedVote) {
  const billLabel = getBillLabel(vote);
  const legislationType = getLegislationTypeLabel(vote.legislation_type);
  const quickSummary = normalizeQuickSummary(vote.aiSummary);
  const safeRepLastName = escapeHtml(repLastName);
  if (vote.vote === "Not Voting") {
    return `Rep. ${safeRepLastName} did not vote on ${escapeHtml(billLabel)}, ${escapeHtml(legislationType)} to ${escapeHtml(quickSummary)}.`;
  }
  return `Rep. ${safeRepLastName} voted ${buildVotePillHtml(vote.vote)} on ${escapeHtml(billLabel)}, ${escapeHtml(legislationType)} to ${escapeHtml(quickSummary)}.`;
}

function buildVoteSentenceText(repLastName: string, vote: EnrichedVote) {
  const billLabel = getBillLabel(vote);
  const legislationType = getLegislationTypeLabel(vote.legislation_type);
  const quickSummary = normalizeQuickSummary(vote.aiSummary);
  if (vote.vote === "Not Voting") {
    return `Rep. ${repLastName} did not vote on ${billLabel}, ${legislationType} to ${quickSummary}.`;
  }
  return `Rep. ${repLastName} voted ${vote.vote} on ${billLabel}, ${legislationType} to ${quickSummary}.`;
}

function buildRepVoteBatchEmail({
  firstName,
  repName,
  votes,
  appOrigin,
}: {
  firstName?: string | null;
  repName: string;
  votes: EnrichedVote[];
  appOrigin: string;
}) {
  if (!Array.isArray(votes) || votes.length === 0) {
    throw new Error("buildRepVoteBatchEmail requires at least one vote");
  }

  const repLastName = getRepLastName(repName);
  const safeRepLastName = escapeHtml(repLastName);
  const safeFirstName = escapeHtml(firstName || "there");
  const loginUrl = new URL("/login", appOrigin).toString();
  const siteUrl = new URL("/", appOrigin).toString();
  const subject = `Here are Rep. ${repLastName}'s latest votes`;

  const itemsHtml = votes
    .map((vote) =>
      `<li style="margin: 0 0 12px;">${buildVoteSentenceHtml(repLastName, vote)}</li>`
    )
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
        <a href="${loginUrl}" style="display: inline-block; padding: 12px 18px; border-radius: 10px; background: #1d4ed8; color: #ffffff; text-decoration: none; font-weight: 700;">Go to VoteFeed</a>
      </p>
      <p style="margin-top: 24px;">Stay Civic,<br /><a href="${siteUrl}" style="color: #1d4ed8; text-decoration: underline;">VoteFeed.org</a></p>
    </div>
  `.trim();

  const text = [
    `Hi ${firstName || "there"},`,
    "",
    `Here are Rep. ${repLastName}'s latest votes,`,
    "",
    ...votes.map((vote) => `- ${buildVoteSentenceText(repLastName, vote)}`),
    "",
    `Let Rep. ${repLastName} know how you feel about their votes!`,
    `Go to VoteFeed: ${loginUrl}`,
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
  for (let attempt = 1; attempt <= RESEND_MAX_SEND_ATTEMPTS; attempt += 1) {
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

    const details = await response.text();
    if (response.ok) {
      await wait(RESEND_MIN_SEND_INTERVAL_MS);
      return details ? JSON.parse(details) : {};
    }

    const shouldRetry =
      response.status === 429 && attempt < RESEND_MAX_SEND_ATTEMPTS;

    if (!shouldRetry) {
      throw new Error(`Resend send failed ${response.status}: ${details}`);
    }

    await wait(getRetryDelayMs(response.headers.get("Retry-After"), attempt));
  }

  throw new Error("Resend send failed after retry attempts");
}

function getRetryDelayMs(retryAfter: string | null, attempt: number) {
  if (retryAfter) {
    const retryAfterSeconds = Number(retryAfter);
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      return retryAfterSeconds * 1000;
    }

    const retryAfterDateMs = Date.parse(retryAfter);
    if (Number.isFinite(retryAfterDateMs)) {
      return Math.max(retryAfterDateMs - Date.now(), RESEND_RETRY_BASE_MS);
    }
  }

  return attempt * RESEND_RETRY_BASE_MS;
}

function groupPendingOutboxRows(rows: OutboxRow[]) {
  const grouped = new Map<string, OutboxGroup>();

  for (const row of rows) {
    const key = `${row.sync_run_id}:${row.member_id}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        syncRunId: row.sync_run_id,
        memberId: row.member_id,
        rows: [],
      });
    }

    grouped.get(key)!.rows.push(row);
  }

  return Array.from(grouped.values()).map((group) => ({
    ...group,
    rows: group.rows.sort((a, b) => {
      if (a.session_number !== b.session_number) {
        return b.session_number - a.session_number;
      }
      return b.roll_call_number - a.roll_call_number;
    }),
  }));
}

function getGroupKey(group: OutboxGroup) {
  return `${group.syncRunId}:${group.memberId}`;
}

function getBillMapKey(vote: BillLookupKey) {
  return `${vote.legislation_type}:${vote.legislation_number}`;
}

function buildLatestSummaryReadyGroupKeyByMember(
  groups: OutboxGroup[],
  billMap: Map<string, BillRow>,
) {
  const latestByMember = new Map<
    string,
    { key: string; sessionNumber: number; rollCallNumber: number }
  >();

  for (const group of groups) {
    const votes = enrichVotes(group.rows, billMap);
    const summaryReadyRollCallGroups = getSummaryReadyRollCallGroups(votes);
    const newestSummaryReadyVote = summaryReadyRollCallGroups[0]?.[0];

    if (!newestSummaryReadyVote) {
      continue;
    }

    const existing = latestByMember.get(group.memberId);

    if (
      !existing ||
      newestSummaryReadyVote.session_number > existing.sessionNumber ||
      (newestSummaryReadyVote.session_number === existing.sessionNumber &&
        newestSummaryReadyVote.roll_call_number > existing.rollCallNumber)
    ) {
      latestByMember.set(group.memberId, {
        key: getGroupKey(group),
        sessionNumber: newestSummaryReadyVote.session_number,
        rollCallNumber: newestSummaryReadyVote.roll_call_number,
      });
    }
  }

  return new Map(
    Array.from(latestByMember, ([memberId, value]) => [memberId, value.key]),
  );
}

async function loadPendingOutboxRows(supabase: SupabaseClient) {
  const rows: OutboxRow[] = [];

  for (
    let from = 0;
    from < MAX_PENDING_OUTBOX_ROWS_PER_INVOCATION;
    from += PENDING_OUTBOX_PAGE_SIZE
  ) {
    const to = Math.min(
      from + PENDING_OUTBOX_PAGE_SIZE - 1,
      MAX_PENDING_OUTBOX_ROWS_PER_INVOCATION - 1,
    );
    const { data, error } = await supabase
      .from("vote_notification_outbox")
      .select(
        "id, sync_run_id, member_id, legislation_type, legislation_number, session_number, roll_call_number, voted_on, vote, created_at, processed_at, attempt_count, last_error",
      )
      .is("processed_at", null)
      .gte("voted_on", NOTIFICATION_START_DATE)
      .order("session_number", { ascending: false })
      .order("roll_call_number", { ascending: false })
      .order("created_at", { ascending: true })
      .order("sync_run_id", { ascending: true })
      .order("member_id", { ascending: true })
      .range(from, to);

    if (error) throw error;

    const pageRows = (data ?? []) as OutboxRow[];
    rows.push(...pageRows);

    if (pageRows.length < PENDING_OUTBOX_PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

async function countPendingOutboxGroups(supabase: SupabaseClient) {
  const pendingRows = await loadPendingOutboxRows(supabase);
  return groupPendingOutboxRows(pendingRows).length;
}

async function findRepByBioguideId(
  supabase: SupabaseClient,
  bioguideId: string,
) {
  const { data, error } = await supabase
    .from("reps")
    .select("bioguideid, full_name, chamber, state, congressionaldistrict, is_current_member")
    .eq("bioguideid", bioguideId)
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as RepRow | null;
}

async function findRepsByBioguideIds(
  supabase: SupabaseClient,
  bioguideIds: string[],
) {
  const uniqueIds = [...new Set(bioguideIds.map((id) => String(id).trim()).filter(Boolean))];
  if (uniqueIds.length === 0) {
    return new Map<string, RepRow>();
  }

  const { data, error } = await supabase
    .from("reps")
    .select("bioguideid, full_name, chamber, state, congressionaldistrict, is_current_member")
    .in("bioguideid", uniqueIds);

  if (error) throw error;

  return new Map(
    ((data ?? []) as RepRow[]).map((rep) => [rep.bioguideid, rep]),
  );
}

async function findRepByDistrict(
  supabase: SupabaseClient,
  state: string,
  district: number,
) {
  const { data, error } = await supabase
    .from("reps")
    .select("bioguideid, full_name, chamber, state, congressionaldistrict, is_current_member")
    .eq("state", state)
    .eq("congressionaldistrict", district)
    .eq("is_current_member", true)
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as RepRow | null;
}

async function findBillsForVotes(
  supabase: SupabaseClient,
  votes: BillLookupKey[],
) {
  const billTypes = [...new Set(votes.map((vote) => vote.legislation_type))];
  const billNumbers = [...new Set(votes.map((vote) => vote.legislation_number))];

  if (billTypes.length === 0 || billNumbers.length === 0) {
    return new Map<string, BillRow>();
  }

  const { data, error } = await supabase
    .from("bills")
    .select("bill_type, number, title, summary, aisummary, legislation_url")
    .in("bill_type", billTypes)
    .in("number", billNumbers);

  if (error) throw error;

  return new Map(
    ((data ?? []) as BillRow[]).map((bill) => [
      getBillMapKey({
        legislation_type: bill.bill_type,
        legislation_number: bill.number,
      }),
      bill,
    ]),
  );
}

function enrichVotes(votes: OutboxRow[], billMap: Map<string, BillRow>) {
  return votes.map((vote) => {
    const bill = billMap.get(getBillMapKey(vote));

    return {
      outboxId: vote.id,
      legislation_type: vote.legislation_type,
      legislation_number: vote.legislation_number,
      session_number: vote.session_number,
      roll_call_number: vote.roll_call_number,
      voted_on: vote.voted_on,
      vote: vote.vote,
      billTitle:
        bill?.title ??
        `${String(vote.legislation_type).toUpperCase()} ${vote.legislation_number}`,
      billSummary: bill?.summary ?? null,
      aiSummary: bill?.aisummary ?? null,
      legislationUrl: bill?.legislation_url ?? null,
    };
  });
}

function groupVotesByRollCall<
  T extends { session_number: number; roll_call_number: number },
>(votes: T[]) {
  const grouped = new Map<string, T[]>();

  for (const vote of votes) {
    const key = `${vote.session_number}:${vote.roll_call_number}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(vote);
  }

  return Array.from(grouped.values());
}

function hasBillSummary(vote: { billSummary: string | null }) {
  return String(vote.billSummary ?? "").trim() !== "";
}

function hasAiSummary(vote: { aiSummary: string | null }) {
  return normalizeQuickSummary(vote.aiSummary) !== "";
}

function isOutboxRowSummaryReady(
  row: OutboxRow,
  billMap: Map<string, BillRow>,
) {
  const bill = billMap.get(getBillMapKey(row));
  return hasBillSummary({ billSummary: bill?.summary ?? null }) &&
    hasAiSummary({ aiSummary: bill?.aisummary ?? null });
}

function isDeliverableHouseRep(rep: RepRow | null | undefined) {
  const chamber = String(rep?.chamber ?? "").trim().toLowerCase();
  return chamber.includes("house") && rep?.congressionaldistrict != null &&
    rep?.is_current_member !== false;
}

function getUndeliverableGroupReason(
  memberId: string,
  rep: RepRow | null | undefined,
) {
  if (!rep) {
    return `Skipped notification queue for member ${memberId}: no matching rep record`;
  }
  if (!String(rep.chamber ?? "").trim().toLowerCase().includes("house")) {
    return `Skipped notification queue for member ${memberId}: chamber ${rep.chamber ?? "unknown"} is not deliverable`;
  }
  if (rep.congressionaldistrict == null) {
    return `Skipped notification queue for member ${memberId}: missing congressional district`;
  }
  return `Skipped notification queue for member ${memberId}: undeliverable rep`;
}

function getSummaryReadyRollCallGroups(votes: EnrichedVote[]) {
  return groupVotesByRollCall(votes).filter((rollCallVotes) =>
    rollCallVotes.every((vote) => hasBillSummary(vote) && hasAiSummary(vote))
  );
}

function isVoteNewerThanCursor(
  vote: Pick<EnrichedVote, "session_number" | "roll_call_number">,
  user: Pick<
    UserRow,
    "last_notified_session_number" | "last_notified_roll_call_number"
  >,
) {
  const lastSession = user.last_notified_session_number;
  const lastRollCall = user.last_notified_roll_call_number;

  return (
    lastSession == null ||
    lastRollCall == null ||
    vote.session_number > lastSession ||
    (vote.session_number === lastSession &&
      vote.roll_call_number > lastRollCall)
  );
}

function buildVotesForUser(
  user: UserRow,
  summaryReadyRollCallGroups: EnrichedVote[][],
) {
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

async function findLatestSummaryReadyRollCallVotesForRep(
  supabase: SupabaseClient,
  memberId: string,
) {
  const { data, error } = await supabase
    .from("member_voting_record")
    .select(
      "id, member_id, legislationnumber, legislation_type, session_number, roll_call_number, voted_on, vote",
    )
    .eq("member_id", memberId)
    .gte("voted_on", NOTIFICATION_START_DATE)
    .order("voted_on", { ascending: false, nullsFirst: false })
    .order("session_number", { ascending: false })
    .order("roll_call_number", { ascending: false })
    .order("id", { ascending: false })
    .limit(250);

  if (error) throw error;
  const recentVotes = (data ?? []) as LatestVoteRow[];
  if (recentVotes.length === 0) return [];

  const billMap = await findBillsForVotes(
    supabase,
    recentVotes.map((vote) => ({
      legislation_type: vote.legislation_type,
      legislation_number: vote.legislationnumber,
    })),
  );

  const enrichedVotes = recentVotes.map((vote) => {
    const bill = billMap.get(`${vote.legislation_type}:${vote.legislationnumber}`);

    return {
      outboxId: null,
      legislation_type: vote.legislation_type,
      legislation_number: vote.legislationnumber,
      session_number: vote.session_number,
      roll_call_number: vote.roll_call_number,
      voted_on: vote.voted_on,
      vote: vote.vote,
      billTitle:
        bill?.title ??
        `${String(vote.legislation_type).toUpperCase()} ${vote.legislationnumber}`,
      billSummary: bill?.summary ?? null,
      aiSummary: bill?.aisummary ?? null,
      legislationUrl: bill?.legislation_url ?? null,
    } satisfies EnrichedVote;
  });

  return getSummaryReadyRollCallGroups(enrichedVotes)[0] ?? [];
}

function isInitialNotificationUser(user: UserRow) {
  return (
    user.last_notified_session_number == null ||
    user.last_notified_roll_call_number == null
  );
}

async function findUsersNeedingBootstrapNotification(
  supabase: SupabaseClient,
) {
  const { data, error } = await supabase
    .from("users")
    .select(
      "id, email, first_name, last_name, state, district, last_notified_session_number, last_notified_roll_call_number",
    )
    .eq("notifications_enabled", true)
    .not("email", "is", null)
    .not("state", "is", null)
    .not("district", "is", null);

  if (error) throw error;

  return ((data ?? []) as UserRow[]).filter(isInitialNotificationUser);
}

async function findAllNotificationUsers(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("users")
    .select(
      "id, email, first_name, last_name, state, district, last_notified_session_number, last_notified_roll_call_number",
    )
    .eq("notifications_enabled", true)
    .not("email", "is", null)
    .not("state", "is", null)
    .not("district", "is", null);

  if (error) throw error;

  return (data ?? []) as UserRow[];
}

function getDistrictKey(state: string, district: number) {
  return `${String(state).trim()}:${Number(district)}`;
}

function groupUsersByDistrict(users: UserRow[]) {
  const grouped = new Map<string, UserRow[]>();

  for (const user of users) {
    const key = getDistrictKey(user.state, user.district);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(user);
  }

  return grouped;
}

async function markUserVoteNotificationSent(
  supabase: SupabaseClient,
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

async function markOutboxRowsProcessed(
  supabase: SupabaseClient,
  ids: string[],
) {
  if (ids.length === 0) return;

  for (let index = 0; index < ids.length; index += OUTBOX_UPDATE_BATCH_SIZE) {
    const batchIds = ids.slice(index, index + OUTBOX_UPDATE_BATCH_SIZE);
    const { error } = await supabase
      .from("vote_notification_outbox")
      .update({
        processed_at: new Date().toISOString(),
        last_error: null,
      })
      .in("id", batchIds);

    if (error) throw error;
  }
}

async function markOutboxRowsSkipped(
  supabase: SupabaseClient,
  rows: OutboxRow[],
  reason: string,
) {
  if (rows.length === 0) return;

  const ids = rows.map((row) => row.id);
  for (let index = 0; index < ids.length; index += OUTBOX_UPDATE_BATCH_SIZE) {
    const batchIds = ids.slice(index, index + OUTBOX_UPDATE_BATCH_SIZE);
    const { error } = await supabase
      .from("vote_notification_outbox")
      .update({
        processed_at: new Date().toISOString(),
        last_error: reason,
      })
      .in("id", batchIds);

    if (error) throw error;
  }
}

async function markOutboxRowsFailed(
  supabase: SupabaseClient,
  rows: OutboxRow[],
  errorMessage: string,
) {
  if (rows.length === 0) {
    return { deadLettered: false, attemptCount: 0 };
  }

  const nextAttemptCount =
    Math.max(...rows.map((row) => row.attempt_count ?? 0)) + 1;
  const deadLettered = nextAttemptCount >= MAX_FAILURE_ATTEMPTS;

  const ids = rows.map((row) => row.id);
  for (let index = 0; index < ids.length; index += OUTBOX_UPDATE_BATCH_SIZE) {
    const batchIds = ids.slice(index, index + OUTBOX_UPDATE_BATCH_SIZE);
    const { error } = await supabase
      .from("vote_notification_outbox")
      .update({
        attempt_count: nextAttemptCount,
        last_error: errorMessage,
        processed_at: deadLettered ? new Date().toISOString() : null,
      })
      .in("id", batchIds);

    if (error) throw error;
  }
  return { deadLettered, attemptCount: nextAttemptCount };
}

function hasTimeRemaining(startedAtMs: number) {
  return Date.now() - startedAtMs < MAX_RUNTIME_MS;
}

function readResponseText(payload: {
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
}) {
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text ?? "")
    .join("")
    .trim();
}

async function generateQuickSummary(
  openAiApiKey: string,
  officialSummary: string,
) {
  const instructions = `Turn a bill summary into exactly one short, plain-language action phrase that fits after "a bill to" or "a resolution to". Start with a lowercase base-form action verb such as stop, help, require, delay, allow, add, cut, or protect. Do not begin with "to", "this bill", "the bill", "this resolution", or "the legislation". Use everyday words at a grade 4-6 reading level. Put the main action first. Include who is affected when necessary. Do not add facts, opinions, a representative, a vote, a bill identifier, or a legislation type. Do not write a complete sentence or end with punctuation. Return only the phrase, with a maximum of 180 characters.`;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_MODEL") || DEFAULT_OPENAI_MODEL,
      reasoning: { effort: "low" },
      instructions,
      input: officialSummary,
    }),
  });
  const details = await response.text();
  if (!response.ok) {
    throw new Error(`AI summary generation failed ${response.status}: ${details}`);
  }
  const quickSummary = normalizeQuickSummary(
    readResponseText(JSON.parse(details)),
  );
  if (!quickSummary) throw new Error("AI summary generation returned no text");
  return quickSummary.slice(0, 180).replace(/[.!?]+$/, "");
}

async function generateMissingAiSummaries(
  supabase: SupabaseClient,
  billMap: Map<string, BillRow>,
  openAiApiKey: string | undefined,
) {
  const missingBills = [...billMap.values()]
    .filter((bill) =>
      hasBillSummary({ billSummary: bill.summary }) &&
      !hasAiSummary({ aiSummary: bill.aisummary })
    )
    .slice(0, MAX_AI_SUMMARIES_PER_INVOCATION);
  if (missingBills.length === 0) return 0;
  if (!openAiApiKey) {
    console.warn(
      "[send-vote-notifications] deferring AI summaries: OPENAI_API_KEY is not configured",
    );
    return 0;
  }
  let generatedCount = 0;
  for (const bill of missingBills) {
    const aiSummary = await generateQuickSummary(openAiApiKey, bill.summary!);
    const { error } = await supabase
      .from("bills")
      .update({ aisummary: aiSummary })
      .eq("bill_type", bill.bill_type)
      .eq("number", bill.number);
    if (error) throw error;
    bill.aisummary = aiSummary;
    generatedCount += 1;
  }
  return generatedCount;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const requestBody = await req.json().catch(() => ({}));
  const generateOnly = requestBody?.mode === "generate-only";

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const resendFromEmail = Deno.env.get("RESEND_FROM_EMAIL");
  const appOrigin = Deno.env.get("APP_ORIGIN");
  const openAiApiKey = Deno.env.get("OPENAI_API_KEY");

  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    !resendApiKey ||
    !resendFromEmail ||
    !appOrigin
  ) {
    return json({ error: "Missing function secrets" }, 500);
  }

  const startedAtMs = Date.now();

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const pendingRows = await loadPendingOutboxRows(supabase);
    const allPendingGroups = groupPendingOutboxRows(pendingRows);
    const repByMemberId = await findRepsByBioguideIds(
      supabase,
      allPendingGroups.map((group) => group.memberId),
    );
    let skippedUndeliverableGroupCount = 0;

    for (const group of allPendingGroups) {
      const rep = repByMemberId.get(group.memberId) ?? null;
      if (isDeliverableHouseRep(rep)) continue;
      const reason = getUndeliverableGroupReason(group.memberId, rep);
      console.warn(`[send-vote-notifications] ${reason}`);
      await markOutboxRowsSkipped(supabase, group.rows, reason);
      skippedUndeliverableGroupCount += 1;
    }

    const deliverablePendingRows = pendingRows.filter((row) =>
      isDeliverableHouseRep(repByMemberId.get(row.member_id) ?? null)
    );
    const pendingBillMap = await findBillsForVotes(
      supabase,
      deliverablePendingRows,
    );
    const generatedAiSummaryCount = await generateMissingAiSummaries(
      supabase,
      pendingBillMap,
      openAiApiKey,
    );
    if (generateOnly) {
      return json({
        generatedAiSummaryCount,
        pendingVoteCount: deliverablePendingRows.length,
      });
    }
    const summaryReadyPendingRows = deliverablePendingRows.filter((row) =>
      isOutboxRowSummaryReady(row, pendingBillMap)
    );
    const noSummaryPendingRows = deliverablePendingRows.filter((row) =>
      !isOutboxRowSummaryReady(row, pendingBillMap)
    );
    const deferredNoSummaryGroupCount =
      groupPendingOutboxRows(noSummaryPendingRows).length;
    const deliverablePendingGroups = groupPendingOutboxRows(
      summaryReadyPendingRows,
    ).filter((group) =>
      isDeliverableHouseRep(repByMemberId.get(group.memberId) ?? null)
    );
    const latestSummaryReadyGroupKeyByMember =
      buildLatestSummaryReadyGroupKeyByMember(
        deliverablePendingGroups,
        pendingBillMap,
      );
    const pendingMemberIds = new Set(
      deliverablePendingRows.map((row) => row.member_id),
    );
    const groupsToProcess = deliverablePendingGroups.slice(
      0,
      MAX_GROUPS_PER_INVOCATION,
    );
    const notificationUsersByDistrict = groupUsersByDistrict(
      await findAllNotificationUsers(supabase),
    );
    const processedOutboxRowIds = new Set<string>();

    let processedGroupCount = 0;
    let failedGroupCount = 0;
    let deadLetterGroupCount = 0;
    let deferredGroupCount = deferredNoSummaryGroupCount;
    let sentEmailCount = 0;
    let bootstrapEmailCount = 0;
    let bootstrapFailureCount = 0;
    let emailLimitReached = false;
    let timeLimitReached = false;

    for (const group of groupsToProcess) {
      if (!hasTimeRemaining(startedAtMs)) {
        timeLimitReached = true;
        deferredGroupCount += 1;
        break;
      }

      let failureRows = group.rows;

      try {
        const rep = repByMemberId.get(group.memberId) ??
          await findRepByBioguideId(supabase, group.memberId);
        if (!isDeliverableHouseRep(rep)) {
          const reason = getUndeliverableGroupReason(group.memberId, rep);
          console.warn(`[send-vote-notifications] ${reason}`);
          await markOutboxRowsSkipped(supabase, group.rows, reason);
          skippedUndeliverableGroupCount += 1;
          continue;
        }

        const votes = enrichVotes(group.rows, pendingBillMap);
        const summaryReadyRollCallGroups = getSummaryReadyRollCallGroups(votes);

        if (summaryReadyRollCallGroups.length === 0) {
          deferredGroupCount += 1;
          continue;
        }

        const processableRowIds = new Set(
          summaryReadyRollCallGroups
            .flatMap((rollCallVotes) => rollCallVotes.map((vote) => vote.outboxId))
            .filter((id): id is string => Boolean(id)),
        );
        const processableRows = group.rows.filter((row) =>
          processableRowIds.has(row.id)
        );
        failureRows = processableRows;

        const users = notificationUsersByDistrict.get(
          getDistrictKey(rep.state, rep.congressionaldistrict),
        ) ?? [];
        const notificationTargets = users
          .map((user) => {
            const votesForUser = buildVotesForUser(user, summaryReadyRollCallGroups);
            if (votesForUser.length === 0) return null;
            if (
              isInitialNotificationUser(user) &&
              latestSummaryReadyGroupKeyByMember.get(group.memberId) !==
                getGroupKey(group)
            ) {
              return null;
            }
            return { user, votes: votesForUser };
          })
          .filter((target): target is { user: UserRow; votes: EnrichedVote[] } =>
            Boolean(target)
          );

        if (notificationTargets.length === 0) {
          for (const row of processableRows) {
            processedOutboxRowIds.add(row.id);
          }
          processedGroupCount += 1;
          if (processableRows.length < group.rows.length) {
            deferredGroupCount += 1;
          }
          continue;
        }

        let groupDeferred = false;

        for (const target of notificationTargets) {
          if (!hasTimeRemaining(startedAtMs)) {
            timeLimitReached = true;
            groupDeferred = true;
            break;
          }

          if (sentEmailCount >= MAX_EMAILS_PER_INVOCATION) {
            emailLimitReached = true;
            groupDeferred = true;
            break;
          }

          const email = buildRepVoteBatchEmail({
            firstName: target.user.first_name,
            repName: rep.full_name,
            votes: target.votes,
            appOrigin,
          });

          await sendEmail(resendApiKey, {
            from: resendFromEmail,
            to: target.user.email,
            subject: email.subject,
            html: email.html,
            text: email.text,
          });

          await markUserVoteNotificationSent(
            supabase,
            target.user.id,
            target.votes[0].session_number,
            target.votes[0].roll_call_number,
          );

          sentEmailCount += 1;
        }

        if (groupDeferred) {
          deferredGroupCount += 1;
          break;
        }

        for (const row of processableRows) {
          processedOutboxRowIds.add(row.id);
        }
        processedGroupCount += 1;
        if (processableRows.length < group.rows.length) {
          deferredGroupCount += 1;
        }
      } catch (error) {
        const message = getErrorMessage(error);
        console.error(
          `[send-vote-notifications] failed ${group.syncRunId}:${group.memberId}: ${message}`,
        );
        const failureResult = await markOutboxRowsFailed(
          supabase,
          failureRows,
          message,
        );
        failedGroupCount += 1;
        if (failureResult.deadLettered) {
          deadLetterGroupCount += 1;
        }
      }
    }

    await markOutboxRowsProcessed(supabase, [...processedOutboxRowIds]);

    if (hasTimeRemaining(startedAtMs) && sentEmailCount < MAX_EMAILS_PER_INVOCATION) {
      const bootstrapUsers = await findUsersNeedingBootstrapNotification(supabase);
      const repCache = new Map<string, RepRow | null>();
      const bootstrapTargets = new Map<
        string,
        { rep: RepRow; votes: EnrichedVote[]; users: UserRow[] }
      >();

      for (const user of bootstrapUsers) {
        if (!hasTimeRemaining(startedAtMs)) {
          timeLimitReached = true;
          break;
        }

        try {
          const districtKey = `${user.state}:${user.district}`;
          let rep = repCache.get(districtKey);
          if (rep === undefined) {
            rep = await findRepByDistrict(supabase, user.state, user.district);
            repCache.set(districtKey, rep);
          }

          if (!rep || rep.congressionaldistrict == null) continue;
          if (pendingMemberIds.has(rep.bioguideid)) continue;

          let target = bootstrapTargets.get(rep.bioguideid);
          if (!target) {
            const latestVotes = await findLatestSummaryReadyRollCallVotesForRep(
              supabase,
              rep.bioguideid,
            );
            if (latestVotes.length === 0) continue;
            target = { rep, votes: latestVotes, users: [] };
            bootstrapTargets.set(rep.bioguideid, target);
          }

          target.users.push(user);
        } catch (error) {
          const message = getErrorMessage(error);
          console.error(
            `[send-vote-notifications] bootstrap prep failed for user ${user.id}: ${message}`,
          );
          bootstrapFailureCount += 1;
        }
      }

      for (const target of bootstrapTargets.values()) {
        for (const user of target.users) {
          if (!hasTimeRemaining(startedAtMs)) {
            timeLimitReached = true;
            break;
          }

          if (sentEmailCount >= MAX_EMAILS_PER_INVOCATION) {
            emailLimitReached = true;
            break;
          }

          try {
            const email = buildRepVoteBatchEmail({
              firstName: user.first_name,
              repName: target.rep.full_name,
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
              target.votes[0].session_number,
              target.votes[0].roll_call_number,
            );

            sentEmailCount += 1;
            bootstrapEmailCount += 1;
          } catch (error) {
            const message = getErrorMessage(error);
            console.error(
              `[send-vote-notifications] bootstrap send failed for user ${user.id}: ${message}`,
            );
            bootstrapFailureCount += 1;
          }
        }

        if (timeLimitReached || emailLimitReached) {
          break;
        }
      }
    }

    const remainingPendingGroupCount = await countPendingOutboxGroups(supabase);

    return json({
      loadedPendingVoteCount: pendingRows.length,
      loadedPendingGroupCount: allPendingGroups.length,
      summaryReadyPendingVoteCount: summaryReadyPendingRows.length,
      generatedAiSummaryCount,
      summaryReadyPendingGroupCount: deliverablePendingGroups.length,
      deferredNoSummaryGroupCount,
      skippedUndeliverableGroupCount,
      processedGroupCount,
      failedGroupCount,
      deadLetterGroupCount,
      deferredGroupCount,
      sentEmailCount,
      bootstrapEmailCount,
      bootstrapFailureCount,
      remainingPendingGroupCount,
      emailLimitReached,
      timeLimitReached,
      elapsedMs: Date.now() - startedAtMs,
    });
  } catch (error) {
    console.error(error);
    return json(
      { error: getErrorMessage(error) },
      500,
    );
  }
});
