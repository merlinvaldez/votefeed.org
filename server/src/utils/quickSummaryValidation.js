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

export function isUsableQuickSummary(value, officialSummary = null) {
  const summary = String(value ?? "").replace(/\s+/g, " ").trim();
  if (
    summary.length === 0 || summary.length > 180 ||
    PROMPT_ECHO_PATTERNS.some((pattern) => pattern.test(summary))
  ) return false;

  const source = String(officialSummary ?? "");
  return LEGAL_QUALIFIER_RULES.every((rule) =>
    !rule.source.test(source) || rule.output.test(summary)
  );
}
