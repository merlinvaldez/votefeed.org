# Mini Project: Build a Daily Vote Feed Sync API

## Goal
Build a small Node.js and Express app that simulates new congressional vote data, syncs only the new rows, and returns a feed sorted from newest vote to oldest vote.

## What You Are Building
You are building a tiny backend service with three jobs: hold fake upstream vote data, sync only the rows that arrived after the last successful sync, and expose a feed endpoint for one representative. This is a useful beginner project because it teaches one complete backend workflow instead of isolated concepts: routing, state, timestamps, deduplication, and sorting.

## Documentation References
- https://expressjs.com/en/starter/installing.html
- https://expressjs.com/en/starter/hello-world.html
- https://expressjs.com/en/guide/routing.html
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map
- https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Date/getTime
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toISOString
- https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Server-side/Express_Nodejs/Tutorial_local_library_website

## Core Concepts
- A **route** is a URL path plus an HTTP method that tells the server which code should run for a request.
- A **checkpoint** is the last successful sync time, so the next sync knows where to continue.
- A **Map** is a key-value collection where each key is unique, which makes it useful for deduping rows by `voteId`.
- An **ISO timestamp** is a standard date string such as `2026-03-13T10:30:00.000Z`, which makes time comparisons more predictable.

## Project Setup
This mini project uses the same single-file server shape as the Express Hello World example, because that keeps the moving parts visible while you are still learning how a server works.

```powershell
mkdir vote-sync-mini # Create a new folder for the mini project.
cd vote-sync-mini # Move into the new project folder.
npm init -y # Create package.json with default settings.
npm install express # Install Express so the app can define HTTP routes.
ni server.js -ItemType File -Force # Create the single source file for the project.
```

All of the JavaScript below goes into `server.js`.

## Build Steps

1. Start with the smallest useful Express server. This follows the same single-file pattern used in the Express Hello World example, which is a good beginner starting point.

```js
const express = require("express"); // Load the Express library into this file.
const app = express(); // Create the Express application object.
const PORT = 4000; // Choose the local port your server will listen on.
app.use(express.json()); // Enable JSON parsing for request bodies.
```

Why this step matters: you need a server object before you can define sync or feed routes.

2. Add fake upstream vote data and local app state. The upstream array acts like an external source, and the local state object acts like a tiny in-memory database.

```js
const upstreamVotes = [ // Hold fake incoming vote rows as if they came from an external API.
  { voteId: "v1", billNumber: 101, billTitle: "Clean Rivers Act", votedAt: "2026-03-12T15:00:00.000Z", memberId: "M0001", memberVote: "Yea" }, // Seed vote row one.
  { voteId: "v2", billNumber: 102, billTitle: "School Meals Act", votedAt: "2026-03-13T10:30:00.000Z", memberId: "M0001", memberVote: "Nay" }, // Seed vote row two.
]; // Finish the fake upstream array.

const db = { // Hold the app's local synced state in memory.
  votesById: new Map(), // Store each synced vote by unique voteId.
  billsByNumber: new Map(), // Store one bill record for each bill number.
  lastSyncedAt: null, // Remember the last successful sync time.
}; // Finish the local state object.
```

Why this step matters: syncing only makes sense when you can compare a source of truth against local stored state.

3. Create a helper that fetches only rows after the last checkpoint. `getTime()` turns each date into a number, which makes comparing times easier and more reliable.

```js
function fetchVotesAfter(checkpointIso) { // Return only rows newer than the saved checkpoint.
  if (!checkpointIso) return upstreamVotes; // On the first sync, return every available row.
  const checkpointMs = new Date(checkpointIso).getTime(); // Convert the checkpoint string into milliseconds.
  return upstreamVotes.filter((row) => new Date(row.votedAt).getTime() > checkpointMs); // Keep only rows newer than the checkpoint.
} // Finish the incremental fetch helper.
```

Why this step matters: this is the difference between “reload everything” and “sync only the new data.”

4. Build the actual sync function. This function reads only new rows, stores votes by `voteId`, stores bills by `billNumber`, and then moves the checkpoint forward only after the writes are done.

```js
function syncVotes() { // Run one full sync cycle from source data into local state.
  const newRows = fetchVotesAfter(db.lastSyncedAt); // Pull only rows the app has not synced yet.
  if (newRows.length === 0) return { synced: 0, checkpoint: db.lastSyncedAt }; // Stop early if nothing new exists.
  for (const row of newRows) { // Process each new source row one at a time.
    db.votesById.set(row.voteId, row); // Save the vote row by unique voteId.
    db.billsByNumber.set(row.billNumber, { number: row.billNumber, title: row.billTitle }); // Save basic bill info by bill number.
  } // Finish storing the new rows.
  const latestMs = Math.max(...newRows.map((row) => new Date(row.votedAt).getTime())); // Find the newest synced timestamp.
  db.lastSyncedAt = new Date(latestMs).toISOString(); // Save the new checkpoint as an ISO string.
  return { synced: newRows.length, checkpoint: db.lastSyncedAt }; // Return a summary of the sync run.
} // Finish the sync function.
```

Why this step matters: this function is the core of the entire project because it makes daily updates safe and repeatable.

5. Add a helper that creates one new fake vote on demand. This lets you test “new data arrived later” without editing the file or restarting the app.

```js
function createDemoVote() { // Build one fresh vote row for testing new arrivals.
  const index = upstreamVotes.length + 1; // Count existing source rows so the new row gets a new id.
  const vote = { voteId: `v${index}`, billNumber: 100 + index, billTitle: `Demo Bill ${index}`, votedAt: new Date().toISOString(), memberId: "M0001", memberVote: index % 2 === 0 ? "Nay" : "Yea" }; // Create one timestamped vote object.
  return vote; // Return the new fake row to the caller.
} // Finish the demo vote helper.
```

Why this step matters: a sync tutorial is easier to understand when you can create new source data while the server is already running.

6. Add a route that simulates a new upstream vote and another route that runs the sync. This turns your backend into something you can actually exercise from the terminal.

```js
app.post("/demo/new-vote", (_req, res) => { // Create a route that simulates one newly arrived vote row.
  const vote = createDemoVote(); // Build the new fake upstream vote.
  upstreamVotes.push(vote); // Append the new vote to the source array.
  res.json(vote); // Return the created vote as JSON.
}); // Finish the demo data route.

app.post("/sync", (_req, res) => { // Create a route that runs one sync cycle.
  res.json(syncVotes()); // Return the sync summary as JSON.
}); // Finish the sync route.
```

Why this step matters: these two routes let you prove the sync flow without adding a database or a real external API yet.

7. Add a feed route that returns one representative's votes from newest to oldest. This is the user-facing output of the whole mini project.

```js
app.get("/feed/:memberId", (req, res) => { // Create a route for fetching one member's feed.
  const memberId = req.params.memberId; // Read the memberId from the URL path.
  const feed = [...db.votesById.values()] // Convert stored Map values into a normal array.
    .filter((row) => row.memberId === memberId) // Keep only rows for the requested member.
    .sort((a, b) => new Date(b.votedAt).getTime() - new Date(a.votedAt).getTime()) // Sort newest vote first.
    .map((row) => ({ voteId: row.voteId, billNumber: row.billNumber, billTitle: db.billsByNumber.get(row.billNumber)?.title, votedAt: row.votedAt, memberVote: row.memberVote })); // Shape the response rows.
  res.json({ memberId, count: feed.length, feed }); // Send the finished feed as JSON.
}); // Finish the feed route.
```

Why this step matters: this route turns raw synced data into something a feed UI could render.

8. Start the server so the routes can receive requests. This is the final step that makes the project runnable end to end.

```js
app.listen(PORT, () => { // Start listening for HTTP requests on the chosen port.
  console.log(`Vote sync app running on http://localhost:${PORT}`); // Print the local address for testing.
}); // Finish the server startup code.
```

Why this step matters: until the server is listening, none of the sync or feed code can be reached from your browser or terminal.

## Run and Verify
Use one PowerShell window to run the server and a second PowerShell window to test the routes.

```powershell
node server.js # Start the Express server.
curl.exe -X POST http://localhost:4000/sync # Run the first sync and ingest the seed rows.
curl.exe http://localhost:4000/feed/M0001 # Read the current feed for member M0001.
curl.exe -X POST http://localhost:4000/demo/new-vote # Simulate one new vote arriving from the source.
curl.exe -X POST http://localhost:4000/sync # Sync again so only the new row gets ingested.
curl.exe http://localhost:4000/feed/M0001 # Read the feed again and confirm the newest vote is first.
```

If everything is wired correctly, the first `/sync` call returns a nonzero `synced` count, the `/demo/new-vote` call returns a brand-new row with a fresh timestamp, the second `/sync` call ingests that one new row, and the final `/feed/M0001` response shows the newest `votedAt` at the top.

## Final Recap
You built one complete beginner mini project: a single-file Express server, a fake upstream vote source, a checkpoint-based sync function, repeat-safe `Map` storage, and a newest-first feed route. The core patterns you learned are the same ones you will reuse in a larger app later: route handlers, local state, timestamp comparison, deduping by unique key, and transforming stored data into a feed response.
