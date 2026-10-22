import test from "node:test";
import assert from "node:assert/strict";
import express from "../server/node_modules/express/index.js";
import { createCommentSubmissionHandler } from "../server/src/api/commentSubmission.js";
import { applyCommentModerationResult } from "../server/src/db/queries/comments.js";

test("new and edited comments save and moderate the exact text submitted", async () => {
  for (const scenario of ["new", "edit"]) {
    const events = [];
    const previous = scenario === "edit"
      ? { id: "existing-comment", draft_text: "Previously approved text" }
      : null;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 17 };
      next();
    });
    app.post("/:interactionId/comment/submit", createCommentSubmissionHandler({
      getOwnedInteraction: async (_req, _res, interactionId) => ({
        id: Number(interactionId),
        user_id: 17,
        bill_id: 42,
        rep_bioguide_id: "S000001",
      }),
      saveDraft: async input => {
        events.push(["save", input.draftText]);
        return { ...previous, id: previous?.id ?? "new-comment", draft_text: input.draftText };
      },
      moderateDraft: async text => {
        events.push(["moderate", text]);
        return { status: "approved", moderationReason: null, moderationCategories: {} };
      },
      applyModerationResult: async input => {
        events.push(["apply", input.draftText, input.status]);
        return { id: previous?.id ?? "new-comment", draft_text: input.draftText,
          approved_text: input.draftText, moderation_status: input.status };
      },
      logError: () => assert.fail("valid submissions should not log errors"),
    }));

    await serve(app, async base => {
      const response = await fetch(`${base}/9/comment/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft_text: "The exact latest edited text" }),
      });
      assert.equal(response.status, 200, scenario);
      const body = await response.json();
      assert.equal(body.approved_text, "The exact latest edited text", scenario);
    });

    assert.deepEqual(events, [
      ["save", "The exact latest edited text"],
      ["moderate", "The exact latest edited text"],
      ["apply", "The exact latest edited text", "approved"],
    ], scenario);
  }
});

test("a moderation result cannot approve a draft changed while moderation was running", async () => {
  let sql;
  let params;
  const moderatedText = "Text that was actually moderated";
  const result = await applyCommentModerationResult({
    interactionId: 9,
    draftText: moderatedText,
    status: "approved",
    moderationReason: null,
    moderationCategories: {},
  }, {
    query: async (query, values) => {
      sql = query;
      params = values;
      return { rows: [] };
    },
  });

  assert.equal(result, null);
  assert.match(sql, /WHERE interaction_id = \$1\s+AND draft_text = \$5/);
  assert.equal(params[4], moderatedText);
});

async function serve(app, run) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}
