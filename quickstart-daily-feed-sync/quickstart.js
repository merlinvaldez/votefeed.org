const upstreamVotes = [
  {
    voteId: "119-2026-03-11-101",
    billNumber: 101,
    billTitle: "Clean Rivers Act",
    billSummary: "Funds river cleanup grants.",
    votedAt: "2026-03-11T14:00:00Z",
    memberId: "M0001",
    memberVote: "Yea",
  }, // Day 1 vote.
  {
    voteId: "119-2026-03-12-102",
    billNumber: 102,
    billTitle: "School Meals Expansion",
    billSummary: "Expands school meal eligibility.",
    votedAt: "2026-03-12T15:30:00Z",
    memberId: "M0001",
    memberVote: "Nay",
  }, // Day 2 vote.
  {
    voteId: "119-2026-03-12-103",
    billNumber: 103,
    billTitle: "Transit Safety Upgrade",
    billSummary: "Modernizes transit safety systems.",
    votedAt: "2026-03-12T17:45:00Z",
    memberId: "M0002",
    memberVote: "Yea",
  }, // Another member's vote.
];

const localState = {
  billsByNumber: new Map(),
  votesById: new Map(),
  lastSynchedAt: null,
};

function getMemberFeed(memberId) {
  return [...localState.votesById.values()]
    .filter((vote) => vote.memberId === memberId)
    .sort((a, b) => new Date(b.votedAt) - new Date(a.votedAt))
    .map((vote) => ({
      ...vote,
      bill: localState.billsByNumber.get(vote.billNumber),
    }));
}

console.log("Initial feed size for M0001:", getMemberFeed("M0001").length);
