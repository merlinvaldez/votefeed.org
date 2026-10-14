import test from "node:test";
import assert from "node:assert/strict";
import express from "../server/node_modules/express/index.js";
import db from "../server/src/db/client.js";
import repsRouter from "../server/src/api/reps.js";
import usersRouter from "../server/src/api/users.js";
import { delegationFeedHandler } from "../server/src/api/delegationFeed.js";

async function serve(app, run) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test("registered routes preserve saved-location authority, guest district zero, and legacy feed", async () => {
  const original = db.query;
  const calls = [];
  db.query = async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; };
  const app = express();
  app.use((req, _res, next) => {
    const signedIn = req.headers.authorization === "test";
    req.auth = () => ({ userId: signedIn ? "clerk-id" : null });
    if (signedIn) req.user = { id: 7, state: "Alaska", district: 0 };
    next();
  });
  app.use("/reps", repsRouter);
  app.use("/users", usersRouter);
  try {
    await serve(app, async base => {
      assert.equal((await fetch(`${base}/users/me/delegation/feed`)).status, 401);
      assert.equal(calls.length, 0);
      const guest = await fetch(`${base}/reps/delegation/feed?state=Alaska&district=0`);
      assert.equal(guest.status, 200);
      const body = await guest.json();
      assert.equal(body.delegation.district, 0);
      assert.deepEqual(body.cards, []);
      assert.equal(body.page.nextCursor, null);
      assert.equal(body.totalPolicyCount, 0);
      assert.equal(body.emptyReason, "NO_DELEGATION");
      assert.equal(body.dataStatus, "complete");
      assert.deepEqual(calls[0].params, ["Alaska", 0]);
      calls.length = 0;
      const saved = await fetch(`${base}/users/me/delegation/feed?state=New%20York&district=12&userId=999`, {
        headers: { authorization: "test" },
      });
      assert.equal(saved.status, 200);
      assert.deepEqual(calls[0].params, ["Alaska", 0]);
      const stored = JSON.parse(calls.find(call => call.sql.startsWith("INSERT INTO")).params[2]);
      assert.equal(stored.scope.viewer, "user:7");
      const legacy = await fetch(`${base}/users/me/feed`, { headers: { authorization: "test" } });
      assert.equal(legacy.status, 404);
      assert.deepEqual(await legacy.json(), { error: "No rep for district" });
      calls.length = 0;
      for (const query of ["", "state=Alaska&district=-1", "state=Alaska&district=0&district=1",
        "state=Alaska&state=Ohio&district=0", "state=Alaska&district=0&limit=2x",
        "state=Alaska&district=0&limit=51", "state=Alaska&district=0&limit=1&limit=2",
        "state=Alaska&district=0&offset=0", "state=Alaska&district=0&cursor=junk",
        "state=Alaska&district=0&policyArea=%20"]) {
        assert.equal((await fetch(`${base}/reps/delegation/feed?${query}`)).status, 400, query);
      }
      assert.equal(calls.length, 0);
    });
  } finally { db.query = original; }
});

test("feed handlers return structured cursor errors and safe retryable read failures", async () => {
  for (const [status, code] of [[400, "INVALID_FEED_CURSOR"], [403, "FEED_SCOPE_FORBIDDEN"],
    [409, "FEED_RESTART_REQUIRED"], [500, "DATABASE_FAILURE"]]) {
    const app = express();
    app.get("/", delegationFeedHandler({ readPage: async () => {
      throw Object.assign(new Error("test failure"), { status, code });
    } }));
    app.use((err, _req, res, _next) => res.status(500).json({ code: err.code }));
    await serve(app, async base => {
      const response = await fetch(base);
      assert.equal(response.status, status === 500 ? 503 : status);
      const body = await response.json();
      assert.equal(body.code, status === 500 ? "FEED_READ_FAILED" : code);
      assert.equal(body.retryable, status === 500 || status === 409);
      if (status === 500) {
        assert.equal(body.retry.mode, "same-request");
        assert.equal(body.cards, undefined);
        assert.equal(JSON.stringify(body).includes("test failure"), false);
      }
    });
  }
});

test("roster and vote query failures cannot become successful empty feeds", async () => {
  const original = db.query;
  const app = express();
  app.use("/reps", repsRouter);
  try {
    for (const stage of ["roster", "votes"]) {
      db.query = async sql => {
        if (stage === "roster" || sql.includes("WITH eligible_votes")) {
          throw new Error("private database detail");
        }
        if (sql.includes("SELECT * FROM reps")) return { rows: [{
          bioguideid: "S1", chamber: "Senate", state: "Alaska",
        }] };
        assert.fail("failed reads must not save a snapshot");
      };
      await serve(app, async base => {
        const response = await fetch(`${base}/reps/delegation/feed?state=Alaska&district=0`);
        assert.equal(response.status, 503);
        const body = await response.json();
        assert.equal(body.code, "FEED_READ_FAILED");
        assert.equal(body.retryable, true);
        assert.equal(body.cards, undefined);
        assert.equal(JSON.stringify(body).includes("private database detail"), false);
      });
    }
  } finally { db.query = original; }
});
