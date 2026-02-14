import { Agent, run } from "@openai/agents";
import { readFile } from "node:fs/promises";

const MODEL_CHOICE = process.env.OPENAI_MODEL || "gpt-5.2";
const MODEL_SETTINGS = { reasoning: { effort: "low" } };

let cachedAgentsPromise = null;

async function loadAgents() {
  if (cachedAgentsPromise) return cachedAgentsPromise;
  cachedAgentsPromise = (async () => {
    const simplifierInstructions = await readFile(
      new URL("../ai/prompts/simplifier.md", import.meta.url),
      "utf8",
    );
    const aiSummaryMakerInstructions = await readFile(
      new URL("../ai/prompts/aiSummaryMaker.md", import.meta.url),
      "utf8",
    );

    const sanitizerInstructions = await readFile(
      new URL("../ai/prompts/sanitizer.md", import.meta.url),
      "utf8",
    );

    const simplifierAgent = new Agent({
      name: "Simplifier Agent",
      model: MODEL_CHOICE,
      modelSettings: MODEL_SETTINGS,
      instructions: simplifierInstructions,
    });

    const aiSummaryMakerAgent = new Agent({
      name: "Ai Summary Maker Agent",
      model: MODEL_CHOICE,
      modelSettings: MODEL_SETTINGS,
      instructions: aiSummaryMakerInstructions,
    });

    const sanitizerAgent = new Agent({
      name: "Sanitizer Agent",
      model: MODEL_CHOICE,
      modelSettings: MODEL_SETTINGS,
      instructions: sanitizerInstructions,
    });
    return { simplifierAgent, aiSummaryMakerAgent, sanitizerAgent };
  })();

  return cachedAgentsPromise;
}

export async function generateAiBillSummary(billSummary) {
  const { simplifierAgent, aiSummaryMakerAgent, sanitizerAgent } =
    await loadAgents();
  const simplifierResult = await run(simplifierAgent, billSummary);
  const aiSummaryInput = [
    "bill_summary:",
    billSummary,
    "",
    "simplifier_recommendations:",
    simplifierResult.finalOutput,
  ].join("\n");
  const aiSummaryResult = await run(aiSummaryMakerAgent, aiSummaryInput);
  const sanitizedResult = await run(
    sanitizerAgent,
    aiSummaryResult.finalOutput,
  );
  return sanitizedResult.finalOutput;
}
