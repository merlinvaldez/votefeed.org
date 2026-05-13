import OpenAI from "openai";

function getModerationClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for comment moderation");
  }
  return new OpenAI({ apiKey });
}

function getFlaggedCategories(categories = {}) {
  return Object.entries(categories)
    .filter(([, isFlagged]) => isFlagged === true)
    .map(([name]) => name);
}

function getModerationNotice(flaggedCategories) {
  if (!flaggedCategories.length) return null;
  return "Comment was flagged by moderation, please edit and resubmit";
}

export async function moderateCommentDraft(text) {
  const normalizedText = text.trim();
  if (!normalizedText) {
    throw new Error("Comment text is required for moderation");
  }

  const client = getModerationClient();
  const response = await client.moderations.create({
    model: "omni-moderation-latest",
    input: normalizedText,
  });

  const result = response.results[0];
  const categories = result?.categories ?? null;
  const flaggedCategories = getFlaggedCategories(categories ?? {});
  const isBlocked = Boolean(result?.flagged);

  return {
    status: isBlocked ? "blocked" : "approved",
    moderationReason: isBlocked
      ? getModerationNotice(flaggedCategories)
      : null,
    moderationCategories: categories,
    flaggedCategories,
    model: response.model,
  };
}
