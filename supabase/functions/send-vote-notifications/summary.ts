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

const LEGAL_QUALIFIER_RULES = [
  {
    source: /\bconsider(?:s|ed|ing)?\b/i,
    output: /\b(?:consider(?:s|ed|ing)?|weigh|review)\b/i,
  },
  {
    source: /\bonly\s+(?:if|when)\b/i,
    output: /\bonly\s+(?:if|when)\b/i,
  },
  { source: /\bunless\b/i, output: /\bunless\b/i },
  { source: /\bsubject\s+to\b/i, output: /\bsubject\s+to\b/i },
  { source: /\bconditioned\s+on\b/i, output: /\bconditioned\s+on\b/i },
];

export function preservesLegalQualifiers(
  officialSummary: string | null,
  quickSummary: string,
) {
  const source = String(officialSummary ?? "");
  return LEGAL_QUALIFIER_RULES.every((rule) =>
    !rule.source.test(source) || rule.output.test(quickSummary)
  );
}

export function normalizeQuickSummary(
  summary: string | null,
  officialSummary: string | null = null,
) {
  const normalized = String(summary ?? "")
    .replace(/^\s*to\s+/i, "")
    .replace(/[.!?]+\s*$/, "")
    .trim();
  if (
    PROMPT_ECHO_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    !preservesLegalQualifiers(officialSummary, normalized)
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
  const quickSummary = normalizeQuickSummary(aiSummary, officialSummary);
  if (quickSummary) {
    return {
      kind: "quick",
      text: quickSummary,
    };
  }

  const title = normalizeFallbackTitle(fallbackTitle);
  return title ? { kind: "title", text: title } : null;
}
