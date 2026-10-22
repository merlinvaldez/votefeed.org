export type VoteSummary = {
  kind: "quick" | "title";
  text: string;
};

const PROMPT_ECHO_PATTERNS = [
  /\bdraft\s+(?:quick\s+)?summary\b/i,
  /\bquick\s+summary\s+you\s+want\b/i,
  /\byou\s+want\s+rewritten\b/i,
  /\b(?:rewrite|rewritten|rephrase|summari[sz]e)\s+(?:the|this|your|a)\b/i,
  /\b(?:please\s+)?(?:send|paste|provide)\s+(?:the|your)\s+(?:draft|quick\s+summary|summary)\b/i,
];

export function normalizeQuickSummary(
  summary: string | null,
  _officialSummary: string | null = null,
) {
  const normalized = String(summary ?? "")
    .replace(/^\s*to\s+/i, "")
    .replace(/[.!?]+\s*$/, "")
    .trim();
  if (
    PROMPT_ECHO_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    return "";
  }
  return normalized
    ? normalized.charAt(0).toLowerCase() + normalized.slice(1)
    : "";
}

export function normalizeFallbackTitle(title: string | null) {
  const normalized = String(title ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= 180) return normalized;

  const shortened = normalized.slice(0, 177);
  const lastSpace = shortened.lastIndexOf(" ");
  return shortened.slice(0, lastSpace > 140 ? lastSpace : 177).trimEnd() + "…";
}

export function resolveVoteSummary(
  aiSummary: string | null,
  fallbackTitle: string | null,
  officialSummary: string | null = null,
): VoteSummary | null {
  const quickSummary = normalizeQuickSummary(aiSummary);
  if (quickSummary) {
    return {
      kind: "quick",
      text: quickSummary,
    };
  }

  const title = normalizeFallbackTitle(fallbackTitle);
  return title ? { kind: "title", text: title } : null;
}
