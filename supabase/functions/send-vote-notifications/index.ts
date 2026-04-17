import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { json } from "../_shared/http.ts";

const MAX_GROUPS_PER_INVOCATION = 10;
const MAX_EMAILS_PER_INVOCATION = 25;
const MAX_RUNTIME_MS = 20_000;
const MAX_FAILURE_ATTEMPTS = 5;

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
  state: string;
  congressionaldistrict: number | null;
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

function buildBillPageUrl(
  appOrigin: string,
  legislationType: string,
  legislationNumber: number,
) {
  return new URL(
    `/bill/${encodeURIComponent(String(legislationType).trim().toLowerCase())}/${encodeURIComponent(String(legislationNumber))}`,
    appOrigin,
  ).toString();
}

function getBillLabel(vote: {
  legislation_type: string;
  legislation_number: number;
}) {
  const typeKey = String(vote.legislation_type ?? "").trim().toLowerCase();
  const prefix = BILL_TYPE_LABELS[typeKey] ?? String(typeKey).toUpperCase();
  return `${prefix} ${vote.legislation_number}`;
}

function getVoteDisplayTitle(vote: {
  legislation_type: string;
  legislation_number: number;
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
  votes: EnrichedVote[];
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
      const billUrl = buildBillPageUrl(
        appOrigin,
        vote.legislation_type,
        vote.legislation_number,
      );
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
      const billUrl = buildBillPageUrl(
        appOrigin,
        vote.legislation_type,
        vote.legislation_number,
      );
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

async function buildLatestSummaryReadyGroupKeyByMember(
  supabase: SupabaseClient,
  groups: OutboxGroup[],
) {
  const latestByMember = new Map<
    string,
    { key: string; sessionNumber: number; rollCallNumber: number }
  >();

  for (const group of groups) {
    const billMap = await findBillsForVotes(supabase, group.rows);
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
  const { data, error } = await supabase
    .from("vote_notification_outbox")
    .select(
      "id, sync_run_id, member_id, legislation_type, legislation_number, session_number, roll_call_number, voted_on, vote, created_at, processed_at, attempt_count, last_error",
    )
    .is("processed_at", null)
    .order("created_at", { ascending: true })
    .order("sync_run_id", { ascending: true })
    .order("member_id", { ascending: true })
    .order("session_number", { ascending: false })
    .order("roll_call_number", { ascending: false })
    .limit(1000);

  if (error) throw error;
  return (data ?? []) as OutboxRow[];
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
    .select("bioguideid, full_name, state, congressionaldistrict")
    .eq("bioguideid", bioguideId)
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as RepRow | null;
}

async function findRepByDistrict(
  supabase: SupabaseClient,
  state: string,
  district: number,
) {
  const { data, error } = await supabase
    .from("reps")
    .select("bioguideid, full_name, state, congressionaldistrict")
    .eq("state", state)
    .eq("congressionaldistrict", district)
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
    .select("bill_type, number, title, summary, legislation_url")
    .in("bill_type", billTypes)
    .in("number", billNumbers);

  if (error) throw error;

  return new Map(
    ((data ?? []) as BillRow[]).map((bill) => [
      `${bill.bill_type}:${bill.number}`,
      bill,
    ]),
  );
}

function enrichVotes(votes: OutboxRow[], billMap: Map<string, BillRow>) {
  return votes.map((vote) => {
    const bill = billMap.get(
      `${vote.legislation_type}:${vote.legislation_number}`,
    );

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

function getSummaryReadyRollCallGroups(votes: EnrichedVote[]) {
  return groupVotesByRollCall(votes).filter((rollCallVotes) =>
    rollCallVotes.every(hasBillSummary)
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

async function findNotificationUsersForDistrict(
  supabase: SupabaseClient,
  state: string,
  district: number,
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

  return (data ?? []) as UserRow[];
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

  const { error } = await supabase
    .from("vote_notification_outbox")
    .update({
      processed_at: new Date().toISOString(),
      last_error: null,
    })
    .in("id", ids);

  if (error) throw error;
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

  const { error } = await supabase
    .from("vote_notification_outbox")
    .update({
      attempt_count: nextAttemptCount,
      last_error: errorMessage,
      processed_at: deadLettered ? new Date().toISOString() : null,
    })
    .in(
      "id",
      rows.map((row) => row.id),
    );

  if (error) throw error;
  return { deadLettered, attemptCount: nextAttemptCount };
}

function hasTimeRemaining(startedAtMs: number) {
  return Date.now() - startedAtMs < MAX_RUNTIME_MS;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const resendFromEmail = Deno.env.get("RESEND_FROM_EMAIL");
  const appOrigin = Deno.env.get("APP_ORIGIN");

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
    const latestSummaryReadyGroupKeyByMember =
      await buildLatestSummaryReadyGroupKeyByMember(
        supabase,
        allPendingGroups,
      );
    const pendingMemberIds = new Set(
      allPendingGroups.map((group) => group.memberId),
    );
    const groupsToProcess = allPendingGroups.slice(0, MAX_GROUPS_PER_INVOCATION);

    let processedGroupCount = 0;
    let failedGroupCount = 0;
    let deadLetterGroupCount = 0;
    let deferredGroupCount = 0;
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
        const rep = await findRepByBioguideId(supabase, group.memberId);
        if (!rep || rep.congressionaldistrict == null) {
          throw new Error(
            `Missing rep or district for member ${group.memberId}`,
          );
        }

        const billMap = await findBillsForVotes(supabase, group.rows);
        const votes = enrichVotes(group.rows, billMap);
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

        const users = await findNotificationUsersForDistrict(
          supabase,
          rep.state,
          rep.congressionaldistrict,
        );
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
          await markOutboxRowsProcessed(
            supabase,
            processableRows.map((row) => row.id),
          );
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

        await markOutboxRowsProcessed(
          supabase,
          processableRows.map((row) => row.id),
        );
        processedGroupCount += 1;
        if (processableRows.length < group.rows.length) {
          deferredGroupCount += 1;
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unexpected error";
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
          const message =
            error instanceof Error ? error.message : "Unexpected error";
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
            const message =
              error instanceof Error ? error.message : "Unexpected error";
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
      { error: error instanceof Error ? error.message : "Unexpected error" },
      500,
    );
  }
});
