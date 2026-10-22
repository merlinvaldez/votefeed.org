const PROMPT_ECHO_PATTERNS = [
  /\bdraft\s+(?:quick\s+)?summary\b/i,
  /\bquick\s+summary\s+you\s+want\b/i,
  /\byou\s+want\s+rewritten\b/i,
  /\b(?:rewrite|rewritten|rephrase|summari[sz]e)\s+(?:the|this|your|a)\b/i,
  /\b(?:please\s+)?(?:send|paste|provide)\s+(?:the|your)\s+(?:draft|quick\s+summary|summary)\b/i,
  /\b(?:send|paste|provide)\b.*\b(?:bill\s+summary|summary\s+text)\b/i,
];

export function quickSummaryFailure(value) {
  const summary = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!summary) return "empty output";
  if (summary.length > 180) return "exceeds 180 characters";
  const normalized = summary.replace(/[_-]+/g, " ");
  if (/ai summary failed|failed to generate|could not (?:generate|load)|unable to (?:generate|summari[sz]e)/i.test(normalized) ||
      PROMPT_ECHO_PATTERNS.some(pattern => pattern.test(normalized))) return "prompt echo or failure text";

  return null;
}

export function isUsableQuickSummary(value) {
  return quickSummaryFailure(value) === null;
}
