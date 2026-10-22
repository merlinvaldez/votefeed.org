import { isNotificationDateEligible } from "../_shared/notificationCutoffs.ts";
export { NOTIFICATION_START_AT } from "../_shared/notificationCutoffs.ts";

export type NotificationUser = {
  id: number;
  state: string;
  district: number | null;
};

export type VoteProgress = {
  user_id?: number;
  chamber: string;
  congress_number: number;
  last_notified_session_number: number | null;
  last_notified_roll_call_number: number | null;
  updated_at?: string;
};

export type DigestVote = {
  outboxIds: string[];
  member_id: string;
  member_name: string;
  member_chamber: string | null;
  member_state: string;
  member_district: number | null;
  is_current_member: boolean;
  chamber: string;
  congress_number: number;
  session_number: number;
  roll_call_number: number;
  voted_on: string | null;
  summary_ready: boolean;
};

export type EmailDigestVote = DigestVote & {
  legislation_type: string;
  legislation_number: number;
  vote: string;
};

export type DigestSelection<T extends DigestVote> = {
  votes: T[];
  outboxIds: string[];
  blocked: boolean;
  blockedVoteCount: number;
  progress: VoteProgress[];
};

export function getProgressScopeKey(chamber: string, congressNumber: number) {
  return String(chamber).trim().toLowerCase() + ":" + Number(congressNumber);
}

function getVoteCursorKey(sessionNumber: number, rollCallNumber: number) {
  return Number(sessionNumber) + ":" + Number(rollCallNumber);
}

function isNewerThanProgress(
  vote: Pick<DigestVote, "session_number" | "roll_call_number">,
  progress: VoteProgress | undefined,
) {
  if (!progress) return true;
  const lastSession = progress.last_notified_session_number;
  const lastRollCall = progress.last_notified_roll_call_number;
  if (lastSession == null || lastRollCall == null) return true;
  return vote.session_number > lastSession ||
    (vote.session_number === lastSession &&
      vote.roll_call_number > lastRollCall);
}

function sameState(left: string, right: string) {
  return String(left ?? "").trim().toLowerCase() ===
    String(right ?? "").trim().toLowerCase();
}

function matchesOffice(user: NotificationUser, vote: DigestVote) {
  if (
    vote.is_current_member !== true || !sameState(user.state, vote.member_state)
  ) {
    return false;
  }
  const chamber = String(vote.chamber ?? "").trim().toLowerCase();
  const memberChamber = String(vote.member_chamber ?? "").trim().toLowerCase();
  if (chamber === "house") {
    return memberChamber.includes("house") &&
      user.district != null &&
      vote.member_district != null &&
      Number(user.district) === Number(vote.member_district);
  }
  if (chamber === "senate") {
    return memberChamber.includes("senate");
  }
  return false;
}

function getEventKey(vote: DigestVote) {
  return [
    String(vote.chamber).trim().toLowerCase(),
    Number(vote.congress_number),
    vote.member_id,
    Number(vote.session_number),
    Number(vote.roll_call_number),
  ].join(":");
}

function compareVotesNewestFirst(left: DigestVote, right: DigestVote) {
  const leftTime = Date.parse(left.voted_on ?? "");
  const rightTime = Date.parse(right.voted_on ?? "");
  if (
    Number.isFinite(leftTime) && Number.isFinite(rightTime) &&
    leftTime !== rightTime
  ) {
    return rightTime - leftTime;
  }
  if (left.congress_number !== right.congress_number) {
    return right.congress_number - left.congress_number;
  }
  if (left.session_number !== right.session_number) {
    return right.session_number - left.session_number;
  }
  if (left.roll_call_number !== right.roll_call_number) {
    return right.roll_call_number - left.roll_call_number;
  }
  return left.member_id.localeCompare(right.member_id);
}

export function memberPrefix(chamber: string | null) {
  return String(chamber ?? "").trim().toLowerCase().includes("senate")
    ? "Sen."
    : "Rep.";
}

export function groupNotificationEmailVotes<T extends EmailDigestVote>(
  votes: T[],
) {
  const groups = new Map<string, T[]>();
  for (const vote of votes) {
    const key = JSON.stringify([
      vote.chamber,
      vote.congress_number,
      vote.session_number,
      vote.roll_call_number,
      vote.legislation_type,
      vote.legislation_number,
      vote.vote,
      vote.chamber === "Senate" ? null : vote.member_id,
    ]);
    const group = groups.get(key) ?? [];
    group.push(vote);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function buildUserDigest<T extends DigestVote>(
  user: NotificationUser,
  candidates: T[],
  progressByScope: ReadonlyMap<string, VoteProgress>,
): DigestSelection<T> {
  const selectedByEvent = new Map<string, T>();

  for (const candidate of candidates) {
    if (!isNotificationDateEligible(candidate.chamber, candidate.voted_on)) continue;
    if (!matchesOffice(user, candidate)) continue;

    const scopeKey = getProgressScopeKey(
      candidate.chamber,
      candidate.congress_number,
    );
    if (!isNewerThanProgress(candidate, progressByScope.get(scopeKey))) {
      continue;
    }

    const eventKey = getEventKey(candidate);
    const existing = selectedByEvent.get(eventKey);
    if (!existing) {
      selectedByEvent.set(eventKey, {
        ...candidate,
        outboxIds: [...new Set(candidate.outboxIds)],
      });
      continue;
    }

    const merged = {
      ...existing,
      outboxIds: [...new Set([...existing.outboxIds, ...candidate.outboxIds])],
      summary_ready: existing.summary_ready && candidate.summary_ready,
    } as T;
    selectedByEvent.set(eventKey, merged);
  }

  const votes = [...selectedByEvent.values()].sort(compareVotesNewestFirst);
  const blockedVoteCount = votes.filter((vote) => !vote.summary_ready).length;
  const outboxIds = [...new Set(votes.flatMap((vote) => vote.outboxIds))];
  const progressByNextScope = new Map<string, VoteProgress>();

  for (const vote of votes) {
    const scopeKey = getProgressScopeKey(vote.chamber, vote.congress_number);
    const existing = progressByNextScope.get(scopeKey);
    const isNewer = !existing ||
      vote.session_number > Number(existing.last_notified_session_number) ||
      (vote.session_number === Number(existing.last_notified_session_number) &&
        vote.roll_call_number >
          Number(existing.last_notified_roll_call_number));
    if (!isNewer) continue;

    progressByNextScope.set(scopeKey, {
      chamber: vote.chamber,
      congress_number: vote.congress_number,
      last_notified_session_number: vote.session_number,
      last_notified_roll_call_number: vote.roll_call_number,
    });
  }

  return {
    votes,
    outboxIds,
    blocked: blockedVoteCount > 0,
    blockedVoteCount,
    progress: [...progressByNextScope.values()],
  };
}
