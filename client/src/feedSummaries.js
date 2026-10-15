export const summaryIdentity = card => JSON.stringify([
  card.bill.congress, card.bill.type, card.bill.number,
]);

export const hasSummaryText = value => typeof value === "string" && Boolean(value.trim()) &&
  !/ai summary failed|failed to generate/i.test(value);

// Feed cards carry a summary object; legacy bill responses carry HTML directly.
export function officialSummaryHtml(summary) {
  const html = typeof summary === "string" ? summary : summary?.officialHtml;
  return typeof html === "string" && html.trim() ? html : null;
}

export function summaryView({ showOriginal, officialHtml, simplifiedText, loading, error }) {
  if (showOriginal || error) return { mode: "official", showAction: true,
    message: officialHtml ? null : "The official summary is unavailable." };
  if (hasSummaryText(simplifiedText)) return { mode: "simplified", showAction: false, message: null };
  return { mode: "loading", showAction: true,
    message: loading ? "Creating summary." : "The simplified summary is unavailable." };
}

// Multiple member/event cards on one bill share one request, including Retry.
export function createSummaryRequests() {
  const pending = new Set();
  return {
    begin(key) { if (pending.has(key)) return false; pending.add(key); return true; },
    finish(key) { pending.delete(key); },
  };
}
