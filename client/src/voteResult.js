export function voteResultPresentation(result) {
  const raw = typeof result === "string" ? result.trim() : "";
  const normalized = raw.toLowerCase();
  if (["passed", "bill passed"].includes(normalized)) return { label: "Passed", className: "success", outcome: "passed" };
  if (["failed", "bill failed"].includes(normalized)) return { label: "Failed", className: "danger", outcome: "failed" };
  return { label: raw || "Unavailable", className: "neutral", outcome: null };
}
