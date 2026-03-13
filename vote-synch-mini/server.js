const express = require("express");
const app = express();
const port = 4000;
app.use(express.json());

const upstreamVotes = [
  // Hold fake incoming vote rows as if they came from an external API.
  {
    voteId: "v1",
    billNumber: 101,
    billTitle: "Clean Rivers Act",
    votedAt: "2026-03-12T15:00:00.000Z",
    memberId: "M0001",
    memberVote: "Yea",
  }, // Seed vote row one.
  {
    voteId: "v2",
    billNumber: 102,
    billTitle: "School Meals Act",
    votedAt: "2026-03-13T10:30:00.000Z",
    memberId: "M0001",
    memberVote: "Nay",
  }, // Seed vote row two.
]; // Finish the fake upstream array.

const db = {
  votesById: new Map(),
  billsByNumber: new Map(),
  lastSynchedAt: null,
};

function fetchVotesAfter(checkpointIso) {
  if (!checkpointIso) return upstreamVotes;
  const checkpointMs = new Date(checkpointIso).getTime();
  return upstreamVotes.filter(
    (row) => new Date(row.votedAt).getTime() > checkpointMs,
  );
}

function syncVotes() {
  const newRows = fetchVotesAfter(db.lastSynchedAt);
  if (newRows.length === 0) return { synched: 0, checkpoint: db.lastSynchedAt };
  for (const row of newRows) {
    db.votesById.set(row.voteIdm, row);
    db.billsByNumber.set(row.billNumber, {
      number: row.billNumber,
      title: row.billTitle,
    });
  }
  const latetsMs = Math.max(
    ...newRows.map((row) => new Date(row.votedAt).getTime()),
  );
  db.lastSynchedAt = new Date(latetsMs).toISOString();
  return { synched: newRows.length, checkpoint: db.lastSynchedAt };
}

function createDemoVote() {
  const index = upstreamVotes.length + 1;
  const vote = {
    voteId: `v${index}`,
    billNumber: 100 + index,
    billTitle: `Demo Bill ${index}`,
    votedAt: new Date().toISOString,
    memberId: "M0001",
    memberVote: index % 2,
  };
  return vote;
}

app.post("/demo/new-vote", (_req, res) => {
  const vote = createDemoVote();
  upstreamVotes.push(vote);
  res.json(vote);
});

app.post("/sync", (_req, res) => {
  res.json(syncVotes());
});

app.get("/feed/:memberId", (req, res) => {
  const memberId = req.params.memberId;
  const feed = [...db.votesById.values()]
    .filter((row) => row.memberId === memberId)
    .sort(
      (a, b) => new Date(b.votedAt).getTime() - new Date(a.votedAt.getTime()),
    )
    .map((row) => ({
      voteId: row.voteId,
      billNumber: row.billNumber,
      billTitle: db.billsByNumber.get(row.billNumber)?.title,
      votedAt: row.votedAt,
      memberVote: row.memberVote,
    }));
  res.json({ memberId, count: feed.length, feed });
});

app.listen(port, () => {
  console.log(`Vote Synch app running on http://localhost:${port}`);
});
