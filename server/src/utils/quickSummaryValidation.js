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

export function quickSummaryFailure(value, officialSummary = null) {
  const summary = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!summary) return "empty output";
  if (summary.length > 180) return "exceeds 180 characters";
  const normalized = summary.replace(/[_-]+/g, " ");
  if (/ai summary failed|failed to generate|could not (?:generate|load)|unable to (?:generate|summari[sz]e)/i.test(normalized) ||
      PROMPT_ECHO_PATTERNS.some(pattern => pattern.test(normalized))) return "prompt echo or failure text";

  const source = String(officialSummary ?? "");
  const missing = LEGAL_QUALIFIER_RULES.filter(rule => rule.source.test(source) && !rule.output.test(summary));
  return missing.length ? `missing legal qualifiers: ${missing.map(rule => rule.source.source).join(", ")}` : null;
}

export function isUsableQuickSummary(value, officialSummary = null) {
  return quickSummaryFailure(value, officialSummary) === null;
}
