import test from "node:test";
import assert from "node:assert/strict";
import { generateAiBillSummary } from "../server/src/utils/aiSummaryPipeline.js";
import { isUsableQuickSummary } from "../server/src/utils/quickSummaryValidation.js";
import { getOrCreateAiBillSummary } from "../server/src/db/queries/bills.js";
import { hasSummaryText } from "../client/src/feedSummaries.js";

test("generation retries invalid responses with the original source without keyword rejection", async () => {
  const inputs = [];
  const outputs = ["paste the draft_quick_summary you want simplified", "allow joint media sales"];
  const result = await generateAiBillSummary("Allow joint media sales subject to conditions", {
    agent: {}, runAgent: async (_, input) => { inputs.push(JSON.parse(input)); return { finalOutput: outputs.shift() }; },
  });
  assert.equal(result, "allow joint media sales");
  assert.equal(inputs.length, 2);
  assert.match(inputs[1].validation_feedback, /prompt echo/);
  assert.ok(inputs.every(input => input.bill_summary.includes("subject to conditions")));
});

test("failed generations do not write any cache and a later retry can succeed", async () => {
  const bill = { id: 876543, title: "Protect college athletes", summary: "", aisummary: "AI summary failed", legislation_url: null };
  const writes = [];
  const runner = { query: async (sql, params) => {
    if (sql.startsWith("UPDATE")) { writes.push(params); return { rows: [{ aisummary: params[0] }] }; }
    return { rows: [bill] };
  } };
  await assert.rejects(getOrCreateAiBillSummary(4668, "s", null, { runner, generate: async () => "paste the draft_quick_summary you want simplified" }),
    error => error.code === "AI_SUMMARY_UNAVAILABLE");
  assert.equal(writes.length, 0);
  let supplied;
  const result = await getOrCreateAiBillSummary(4668, "s", null, { runner, generate: async source => { supplied = source; return "protect college athletes"; } });
  assert.equal(supplied, bill.title);
  assert.equal(result, "protect college athletes");
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], result);
});

test("empty output is bounded to three attempts and reported as retryable failure", async () => {
  let calls = 0;
  await assert.rejects(generateAiBillSummary("Protect students", {
    agent: {}, runAgent: async () => { calls++; return { finalOutput: "" }; },
  }), error => error.code === "AI_SUMMARY_UNAVAILABLE" && error.status === 503);
  assert.equal(calls, 3);
});

test("concurrent member cards share successful generation; failures release retry state", async () => {
  const bill = { id: 876544, title: "Require checks", summary: "Require checks", aisummary: null };
  let resolve;
  const generated = new Promise(done => { resolve = done; });
  let calls = 0;
  const options = { runner: { query: async sql => ({ rows: [sql.startsWith("UPDATE") ? { aisummary: "require safety checks" } : bill] }) },
    generate: async () => { calls++; return generated; } };
  const first = getOrCreateAiBillSummary(1, "hr", null, options);
  const second = getOrCreateAiBillSummary(1, "hr", null, options);
  await new Promise(done => setImmediate(done)); resolve("require safety checks");
  assert.deepEqual(await Promise.all([first, second]), ["require safety checks", "require safety checks"]);
  assert.equal(calls, 1);
});

test("prompt echoes and provider failures are not usable cached content on server or client", () => {
  for (const text of ["send the bill summary text you want simplified", "paste the draft_quick_summary you want simplified", "AI summary failed", "Failed to generate summary", "Please provide the summary"]) {
    assert.equal(isUsableQuickSummary(text), false);
    assert.equal(hasSummaryText(text), false);
  }
});

test("missing official summaries use the title and replace a poisoned cache", async () => {
  for (const summary of [null, "", "  ", "<p>&nbsp;</p>"]) {
    const bill = { id: 876550, title: "A joint resolution to stop a student loan rule", summary,
      aisummary: "send the bill summary text you want simplified" };
    const writes = [];
    const runner = { query: async (sql, params) => {
      if (sql.startsWith("UPDATE")) { writes.push(params); return { rows: [{ aisummary: params[0] }] }; }
      return { rows: [bill] };
    } };
    const result = await getOrCreateAiBillSummary(196, "sjres", null, { runner,
      generate: async (source, options) => {
        assert.equal(source, bill.title);
        assert.equal(options.sourceType, "title");
        return generateAiBillSummary(source, { ...options, agent: {}, runAgent: async (_, input) => {
          const payload = JSON.parse(input);
          assert.equal(payload.bill_title, bill.title);
          assert.equal(payload.bill_summary, undefined);
          return { finalOutput: "stop a student loan rule" };
        } });
      } });
    assert.equal(result, "stop a student loan rule");
    assert.equal(writes.length, 1);
  }
});

test("official summaries remain preferred over titles", async () => {
  const bill = { id: 876551, title: "A short title", summary: "Require safety checks", aisummary: null };
  const runner = { query: async (sql, params) => ({ rows: [sql.startsWith("UPDATE") ? { aisummary: params[0] } : bill] }) };
  await getOrCreateAiBillSummary(198, "sjres", null, { runner, generate: async (source, options) => {
    assert.equal(source, bill.summary);
    assert.equal(options.sourceType, "summary");
    return "require safety checks";
  } });
});

test("source keywords do not gate otherwise valid AI summaries", () => {
  for (const source of ["consider banning chemicals", "allow grants only if approved", "allow grants only when approved",
    "allow grants unless denied", "allow grants subject to approval", "allow grants conditioned on approval"]) {
    assert.equal(isUsableQuickSummary("allow grants after approval", source), true);
  }
  assert.equal(isUsableQuickSummary("stop the Medicare payment model",
    "The notice is subject to the Congressional Review Act."), true);
});
