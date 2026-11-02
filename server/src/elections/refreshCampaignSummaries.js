import { readFile } from "node:fs/promises";
import OpenAI from "openai";

export const SUMMARY_PROMPT_VERSION = "campaign-position-summary-action-v1";

const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summaries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          positionVersionId: { type: "string" },
          summary: { type: "string" },
        },
        required: ["positionVersionId", "summary"],
      },
    },
  },
  required: ["summaries"],
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function normalizeActionSummary(value) {
  if (typeof value !== "string") throw new TypeError("Summary must be text");
  const summary = value.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
  if (!summary || summary.length > 500) throw new TypeError("Summary length is invalid");
  if (/^(?:the campaign\b|campaign priority\b|proposed priority\b|the priorities page\b|is working to\b|working to\b|would\b|plans? to\b|aims? to\b|wants? to\b|seeks? to\b|intends? to\b)/i.test(summary)) {
    throw new TypeError("Summary must begin with the direct action or stance");
  }
  return summary;
}

export function validateActionSummaryBatch(rawSummaries, positions) {
  if (!Array.isArray(rawSummaries) || !Array.isArray(positions)) throw new TypeError("Summary batch must be arrays");
  const expected = new Set(positions.map(item => item.positionVersionId));
  const seen = new Set();
  const summaries = rawSummaries.map(item => {
    const positionVersionId = item?.positionVersionId;
    if (typeof positionVersionId !== "string" || !expected.has(positionVersionId) || seen.has(positionVersionId)) {
      throw new TypeError("Summary batch has an unknown or duplicate position id");
    }
    seen.add(positionVersionId);
    return { positionVersionId, summary: normalizeActionSummary(item.summary) };
  });
  if (seen.size !== expected.size) throw new TypeError("Summary batch omitted a position");
  return summaries;
}

export function createCampaignSummaryRefreshProvider({
  client,
  model = process.env.ELECTIONS_SUMMARY_MODEL || process.env.ELECTIONS_AI_MODEL || process.env.OPENAI_MODEL || "gpt-5.4",
  maxAttempts = 4,
} = {}) {
  client ??= new OpenAI({ maxRetries: 0, timeout: 60000 });
  const prompt = readFile(new URL("../ai/prompts/campaignPositionSummaryRefresh.md", import.meta.url), "utf8");

  return {
    model,
    promptVersion: SUMMARY_PROMPT_VERSION,
    async rewrite(items) {
      if (!Array.isArray(items) || !items.length || items.length > 20) throw new TypeError("Provide 1 to 20 positions per summary request");
      const instructions = await prompt;
      const input = items.map(item => ({
        positionVersionId: item.positionVersionId,
        topic: item.topic,
        claimText: item.claimText,
        excerpt: item.excerpt,
      }));

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const response = await client.responses.create({
            model,
            store: false,
            instructions,
            input: JSON.stringify({ positions: input }),
            max_output_tokens: 5000,
            text: {
              format: {
                type: "json_schema",
                name: "campaign_position_summaries",
                strict: true,
                schema: responseSchema,
              },
            },
          });
          if (response.status !== "completed" || !response.output_text) throw new Error("Summary model did not complete");
          const parsed = JSON.parse(response.output_text);
          return validateActionSummaryBatch(parsed.summaries, items);
        } catch (error) {
          if ([400, 401, 403].includes(error.status) || attempt + 1 === maxAttempts) throw error;
          await delay(Math.min(1000 * (2 ** attempt), 15000));
        }
      }
      throw new Error("Summary model did not complete");
    },
  };
}
