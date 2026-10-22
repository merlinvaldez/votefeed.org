import { Agent, run } from "@openai/agents";
import { readFile } from "node:fs/promises";
import { quickSummaryFailure } from "./quickSummaryValidation.js";

const MODEL_CHOICE = process.env.OPENAI_MODEL || "gpt-5.4";
let agentPromise;
async function loadAgent() {
  if (!agentPromise) agentPromise = readFile(new URL("../ai/prompts/aiSummaryMaker.md", import.meta.url), "utf8")
    .then(instructions => new Agent({ name: "Bill Quick Summary", model: MODEL_CHOICE,
      modelSettings: { reasoning: { effort: "low" } }, instructions }));
  return agentPromise;
}

// A single source-grounded call avoids losing the source/qualifiers between agents.
// Empty, oversized, or error-like output is retried; source keywords do not gate it.
export async function generateAiBillSummary(billSummary, options = {}) {
  const source = String(billSummary ?? "").trim();
  if (!source) throw Object.assign(new Error("No official bill text or title available"), { code: "AI_SUMMARY_UNAVAILABLE" });
  const agent = options.agent ?? await loadAgent();
  const runAgent = options.runAgent ?? run;
  let feedback = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const input = JSON.stringify({ [options.sourceType === "title" ? "bill_title" : "bill_summary"]: source,
      simplifier_recommendations: "Explain the main action in one phrase under 180 characters. Preserve legal qualifiers appearing in the source. Use the actual supplied text; never ask for a draft.",
      ...(feedback ? { validation_feedback: feedback } : {}) });
    try {
      const result = await runAgent(agent, input);
      const summary = String(result.finalOutput ?? "").trim().replace(/^['"]|['"]$/g, "").replace(/[.!]+$/, "");
      feedback = quickSummaryFailure(summary, source);
      if (!feedback) return summary;
      console.warn("ai_summary_rejected", { attempt, model: MODEL_CHOICE, reason: feedback, outputLength: summary.length });
    } catch (error) {
      console.error("ai_summary_provider_error", { attempt, model: MODEL_CHOICE, status: error.status, code: error.code, message: error.message });
      if ([400, 401, 403, 429].includes(error.status)) throw error;
      feedback = "The previous request failed. Generate a fresh valid phrase from the supplied source.";
    }
  }
  throw Object.assign(new Error("Summary generation did not produce valid content; retry is available"), { code: "AI_SUMMARY_UNAVAILABLE", status: 503 });
}
