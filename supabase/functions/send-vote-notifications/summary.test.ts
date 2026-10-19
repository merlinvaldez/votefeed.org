import { normalizeFallbackTitle, resolveVoteSummary } from "./summary.ts";

Deno.test("prefers the existing AI quick summary when it is available", () => {
  const summary = resolveVoteSummary(
    "to protect student athletes.",
    "Protect College Sports Act of 2026",
  );

  if (
    summary?.kind !== "quick" || summary.text !== "protect student athletes"
  ) {
    throw new Error("Expected the AI quick summary to be preferred");
  }
});

Deno.test("uses a compact official title when no AI summary is available", () => {
  const summary = resolveVoteSummary(
    null,
    "Protect College Sports Act of 2026",
  );

  if (
    summary?.kind !== "title" ||
    summary.text !== "Protect College Sports Act of 2026"
  ) {
    throw new Error("Expected the official title as the fallback");
  }
});

Deno.test("does not invent a summary when neither source is available", () => {
  if (resolveVoteSummary(null, null) !== null) {
    throw new Error("Expected an empty summary to remain unavailable");
  }
});

Deno.test("keeps fallback titles to a short email length", () => {
  const title = normalizeFallbackTitle(
    "A very long official title ".repeat(12),
  );

  if (!title || title.length > 180 || !title.endsWith("…")) {
    throw new Error("Expected a long title to be shortened with an ellipsis");
  }
});

Deno.test("falls back to the official title when an AI summary drops a condition", () => {
  const summary = resolveVoteSummary(
    "require big data centers to pay for electric grid upgrades",
    "Ratepayer Protection Act",
    "The bill requires states to consider implementing a standard that requires large-load customers to cover electric grid upgrade costs.",
  );

  if (
    summary?.kind !== "title" || summary.text !== "Ratepayer Protection Act"
  ) {
    throw new Error("Expected a summary that drops a condition to be rejected");
  }
});

Deno.test("keeps a required consideration step in the quick summary", () => {
  const summary = resolveVoteSummary(
    "require states to consider rules making large-load customers cover grid upgrade costs",
    "Ratepayer Protection Act",
    "The bill requires states to consider implementing a standard that requires large-load customers to cover electric grid upgrade costs.",
  );

  if (
    summary?.kind !== "quick" || !summary.text.includes("consider")
  ) {
    throw new Error("Expected the legal condition to be preserved");
  }
});

Deno.test("rejects a prompt echo from a previously cached summary", () => {
  const summary = resolveVoteSummary(
    "send the draft quick summary you want rewritten",
    "Ratepayer Protection Act",
  );

  if (summary?.kind !== "title") {
    throw new Error("Expected the prompt echo to use the official title");
  }
});
