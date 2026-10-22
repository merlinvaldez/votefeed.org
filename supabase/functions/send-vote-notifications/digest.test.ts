import {
  buildUserDigest,
  type DigestVote,
  getProgressScopeKey,
  groupNotificationEmailVotes,
  memberPrefix,
  type NotificationUser,
  type VoteProgress,
} from "./digest.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const user: NotificationUser = {
  id: 7,
  state: "New York",
  district: 13,
};

function vote(
  overrides: Partial<DigestVote> & Pick<DigestVote, "outboxIds" | "member_id">,
): DigestVote {
  return {
    member_name: "Jordan Example",
    member_chamber: "House",
    member_state: "New York",
    member_district: 13,
    is_current_member: true,
    chamber: "House",
    congress_number: 119,
    session_number: 2,
    roll_call_number: 10,
    voted_on: "2026-10-23T16:00:00.000Z",
    summary_ready: true,
    ...overrides,
  };
}

Deno.test("the September 15 Eastern cutoff excludes earlier votes", () => {
  const result = buildUserDigest(user, [
    vote({
      outboxIds: ["before"],
      member_id: "house-1",
      voted_on: "2026-09-15T03:59:59.999Z",
    }),
    vote({
      outboxIds: ["on-cutoff"],
      member_id: "house-1",
      voted_on: "2026-09-15T04:00:00.000Z",
    }),
  ], new Map());

  assert(
    result.votes.length === 1,
    "exactly the cutoff-day vote should remain",
  );
  assert(
    result.outboxIds[0] === "on-cutoff",
    "the included vote should be on the cutoff",
  );
});

Deno.test("Senate cutoff excludes all October 22 Eastern votes without changing House eligibility", () => {
  const senate = { member_id: "senate-1", member_chamber: "Senate", chamber: "Senate", member_district: null };
  const result = buildUserDigest(user, [
    vote({ ...senate, outboxIds: ["historical"], voted_on: "2026-09-15T16:00:00Z", summary_ready: false }),
    vote({ ...senate, outboxIds: ["oct22"], voted_on: "2026-10-22T23:59:59-04:00", summary_ready: false }),
    vote({ ...senate, outboxIds: ["eligible"], voted_on: "2026-10-23T00:00:00-04:00" }),
    vote({ ...senate, outboxIds: ["missing"], voted_on: null }),
    vote({ ...senate, outboxIds: ["invalid"], voted_on: "invalid" }),
    vote({ member_id: "house-1", outboxIds: ["house"], voted_on: "2026-09-15T04:00:00Z" }),
  ], new Map());
  assert(result.votes.length === 2, "only the eligible Senate event and existing House cutoff remain");
  assert(result.outboxIds.includes("eligible") && result.outboxIds.includes("house"), "both chamber-specific boundaries are inclusive");
  assert(!result.blocked, "excluded historical Senate summaries must not block House delivery");
});

Deno.test("a digest combines the user's House district and both state Senators", () => {
  const result = buildUserDigest(user, [
    vote({ outboxIds: ["house"], member_id: "house-1" }),
    vote({
      outboxIds: ["other-district"],
      member_id: "house-2",
      member_district: 14,
    }),
    vote({
      outboxIds: ["senator-a"],
      member_id: "senate-1",
      member_name: "Casey Senator",
      member_chamber: "Senate",
      member_district: null,
      chamber: "Senate",
      roll_call_number: 11,
    }),
    vote({
      outboxIds: ["senator-b"],
      member_id: "senate-2",
      member_name: "Riley Senator",
      member_chamber: "Senate",
      member_district: null,
      chamber: "Senate",
      roll_call_number: 12,
    }),
  ], new Map());

  assert(
    result.votes.length === 3,
    "the digest should contain one House and two Senate updates",
  );
  assert(
    result.progress.length === 2,
    "House and Senate progress should remain separate",
  );
  assert(memberPrefix("House") === "Rep.", "House summaries should say Rep.");
  assert(memberPrefix("Senate") === "Sen.", "Senate summaries should say Sen.");
});

Deno.test("Senate-only updates produce a Senate-only digest", () => {
  const result = buildUserDigest(user, [
    vote({
      outboxIds: ["senate-only"],
      member_id: "senate-1",
      member_chamber: "Senate",
      member_district: null,
      chamber: "Senate",
    }),
  ], new Map());

  assert(result.votes.length === 1, "the Senate update should match by state");
  assert(
    result.votes[0].chamber === "Senate",
    "the digest should contain no House update",
  );
});

Deno.test("no newer or post-cutoff votes produce an empty digest", () => {
  const progress = new Map<string, VoteProgress>([
    [getProgressScopeKey("House", 119), {
      chamber: "House",
      congress_number: 119,
      last_notified_session_number: 2,
      last_notified_roll_call_number: 10,
    }],
  ]);
  const result = buildUserDigest(user, [
    vote({
      outboxIds: ["already-notified"],
      member_id: "house-1",
      roll_call_number: 10,
    }),
    vote({
      outboxIds: ["too-old"],
      member_id: "house-1",
      roll_call_number: 11,
      voted_on: "2026-09-15T03:59:59.999Z",
    }),
  ], progress);

  assert(
    result.votes.length === 0,
    "a digest should be empty when nothing is new",
  );
});

Deno.test("progress is independent by chamber and Congress", () => {
  const progress = new Map<string, VoteProgress>([
    [getProgressScopeKey("House", 119), {
      chamber: "House",
      congress_number: 119,
      last_notified_session_number: 2,
      last_notified_roll_call_number: 10,
    }],
    [getProgressScopeKey("Senate", 119), {
      chamber: "Senate",
      congress_number: 119,
      last_notified_session_number: 2,
      last_notified_roll_call_number: 20,
    }],
  ]);

  const result = buildUserDigest(user, [
    vote({
      outboxIds: ["house-old"],
      member_id: "house-1",
      roll_call_number: 10,
    }),
    vote({
      outboxIds: ["house-new"],
      member_id: "house-1",
      roll_call_number: 11,
    }),
    vote({
      outboxIds: ["senate-old"],
      member_id: "senate-1",
      member_chamber: "Senate",
      member_district: null,
      chamber: "Senate",
      roll_call_number: 20,
    }),
    vote({
      outboxIds: ["senate-new"],
      member_id: "senate-1",
      member_chamber: "Senate",
      member_district: null,
      chamber: "Senate",
      roll_call_number: 21,
    }),
    vote({
      outboxIds: ["senate-next-congress"],
      member_id: "senate-1",
      member_chamber: "Senate",
      member_district: null,
      chamber: "Senate",
      congress_number: 120,
      roll_call_number: 1,
    }),
  ], progress);

  assert(
    result.outboxIds.length === 3,
    "only new House/Senate events and the next Congress should remain",
  );
});

Deno.test("an unready matching summary holds the entire user digest", () => {
  const result = buildUserDigest(user, [
    vote({ outboxIds: ["house-ready"], member_id: "house-1" }),
    vote({
      outboxIds: ["senate-unready"],
      member_id: "senate-1",
      member_chamber: "Senate",
      member_district: null,
      chamber: "Senate",
      summary_ready: false,
    }),
  ], new Map());

  assert(
    result.blocked,
    "the combined digest should wait for the Senate summary",
  );
  assert(
    result.blockedVoteCount === 1,
    "the unready vote should be counted as the blocker",
  );
});

Deno.test("a vote arrives in the next digest after its summary is ready", () => {
  const blocked = buildUserDigest(user, [
    vote({
      outboxIds: ["wait-for-summary"],
      member_id: "house-1",
      summary_ready: false,
    }),
  ], new Map());
  const ready = buildUserDigest(user, [
    vote({
      outboxIds: ["wait-for-summary"],
      member_id: "house-1",
      summary_ready: true,
    }),
  ], new Map());

  assert(blocked.blocked, "the initial digest should wait");
  assert(!ready.blocked, "the next digest should proceed when ready");
  assert(
    ready.outboxIds[0] === "wait-for-summary",
    "the waiting vote should be delivered",
  );
});

function emailVote(
  overrides: Partial<DigestVote> &
    Pick<DigestVote, "outboxIds" | "member_id"> & {
      legislation_type?: string;
      legislation_number?: number;
      vote?: string;
    },
) {
  return {
    ...vote({
      ...overrides,
      member_chamber: "Senate",
      member_district: null,
      chamber: "Senate",
    }),
    legislation_type: "hr",
    legislation_number: 9340,
    vote: "Nay",
    ...overrides,
  };
}

Deno.test("same-position Senate votes share one email line", () => {
  const groups = groupNotificationEmailVotes([
    emailVote({ outboxIds: ["senator-a"], member_id: "senate-a" }),
    emailVote({ outboxIds: ["senator-b"], member_id: "senate-b" }),
  ]);

  assert(groups.length === 1, "matching Senate votes should form one line");
  assert(groups[0].length === 2, "the line should name both Senators");
});

Deno.test("different Senate positions stay on separate email lines", () => {
  const groups = groupNotificationEmailVotes([
    emailVote({ outboxIds: ["senator-a"], member_id: "senate-a" }),
    emailVote({
      outboxIds: ["senator-b"],
      member_id: "senate-b",
      vote: "Yea",
    }),
  ]);

  assert(groups.length === 2, "different Senate votes should form two lines");
  assert(
    groups.every((group) => group.length === 1),
    "each differing line should identify one Senator",
  );
});

Deno.test("the same Senate vote on another bill stays a separate email line", () => {
  const groups = groupNotificationEmailVotes([
    emailVote({ outboxIds: ["bill-a"], member_id: "senate-a" }),
    emailVote({
      outboxIds: ["bill-b"],
      member_id: "senate-b",
      legislation_number: 9341,
    }),
  ]);

  assert(groups.length === 2, "different bills should remain separate lines");
});
