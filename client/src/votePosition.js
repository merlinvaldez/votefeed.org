// Classification is separate from the exact recorded value used for grouping.
export function getVotePosition(position, memberCount = 1) {
  const normalized = typeof position === "string" ? position.trim().toLowerCase() : "";
  const comparable = ["yea", "aye", "nay", "no"].includes(normalized);
  return {
    comparable,
    verb: normalized === "not voting" ? "did not vote" : comparable ? "voted" :
      normalized ? (memberCount > 1 ? "were recorded as" : "was recorded as") :
        (memberCount > 1 ? "have no recorded position" : "has no recorded position"),
    label: normalized && normalized !== "not voting" ? position : null,
    className: ["yea", "aye"].includes(normalized) ? "success" :
      ["nay", "no"].includes(normalized) ? "danger" : "neutral",
  };
}
