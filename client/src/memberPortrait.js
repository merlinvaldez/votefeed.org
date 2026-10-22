export function partyPortraitColor(party) {
  const name = String(party ?? "").trim().toLowerCase().replace(/\s+party$/, "");
  if (["d", "democrat", "democratic"].includes(name)) return "#2563eb";
  if (["r", "republican"].includes(name)) return "#dc2626";
  return "#6b7280";
}
