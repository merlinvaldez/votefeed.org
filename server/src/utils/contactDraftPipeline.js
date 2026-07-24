import { Agent, run } from "@openai/agents";
import { readFile } from "node:fs/promises";

const MODEL_CHOICE = process.env.OPENAI_MODEL || "gpt-5.4";
const MODEL_SETTINGS = { reasoning: { effort: "low" } };

let cachedContactDraftAgentPromise = null;

function getRepLastName(fullName = "") {
  const normalized = fullName.trim();
  if (!normalized) return "";
  if (normalized.includes(",")) {
    return normalized.split(",")[0].trim();
  }
  const parts = normalized.split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function formatDistrictLabel(state, district) {
  if (!state || district == null) return "your district";
  return `${state} District ${district}`;
}

function formatLegislationReference(type, number) {
  const normalized = String(type || "hr").toLowerCase();
  const labels = {
    hr: "house bill",
    hres: "house resolution",
    hjres: "house joint resolution",
    hconres: "house concurrent resolution",
  };
  return `${labels[normalized] || "legislation"} ${number}`;
}

function buildRepReference(repFullName = "") {
  const repLastName = getRepLastName(repFullName);
  return repFullName ? `Rep. ${repLastName || repFullName}` : "my representative";
}

function normalizeParagraphBreaks(text = "") {
  return String(text)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitIntoSentences(text = "") {
  return String(text)
    .match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) ?? [];
}

function normalizeCallScript(text = "") {
  const normalized = normalizeParagraphBreaks(text);
  if (!normalized) return "";
  if (normalized.includes("\n\n")) return normalized;

  const sentences = splitIntoSentences(normalized);
  if (sentences.length <= 1) return normalized;

  return sentences.join("\n\n");
}

function parseDraftResponse(rawOutput) {
  const normalized = String(rawOutput || "").trim();
  const withoutFenceStart = normalized.replace(/^```(?:json)?\s*/i, "");
  const cleaned = withoutFenceStart.replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned);
  const callScript = normalizeCallScript(parsed?.callScript ?? "");
  const messageTemplate = normalizeParagraphBreaks(parsed?.messageTemplate ?? "");

  if (!callScript || !messageTemplate) {
    throw new Error("Contact draft output was incomplete");
  }

  return { callScript, messageTemplate };
}

async function loadContactDraftAgent() {
  if (cachedContactDraftAgentPromise) return cachedContactDraftAgentPromise;
  cachedContactDraftAgentPromise = (async () => {
    const contactDraftInstructions = await readFile(
      new URL("../ai/prompts/contactDraftMaker.md", import.meta.url),
      "utf8",
    );

    return new Agent({
      name: "Contact Draft Maker Agent",
      model: MODEL_CHOICE,
      modelSettings: MODEL_SETTINGS,
      instructions: contactDraftInstructions,
    });
  })();

  return cachedContactDraftAgentPromise;
}

export async function generateCommentContactDrafts({
  constituentName,
  userState,
  userDistrict,
  billType,
  billNumber,
  repFullName,
  stance,
  approvedCommentText,
}) {
  const contactDraftAgent = await loadContactDraftAgent();
  const districtLabel = formatDistrictLabel(userState, userDistrict);
  const legislationReference = formatLegislationReference(billType, billNumber);
  const repReference = buildRepReference(repFullName);
  const positionVerb = stance === "approve" ? "agree" : "disagree";

  const input = [
    `constituent_name: ${constituentName || "[Your Name]"}`,
    `district_label: ${districtLabel}`,
    `legislation_reference: ${legislationReference}`,
    `rep_reference: ${repReference}`,
    `position_verb: ${positionVerb}`,
    `approved_comment_text: ${approvedCommentText}`,
  ].join("\n");

  const result = await run(contactDraftAgent, input);
  return parseDraftResponse(result.finalOutput);
}
