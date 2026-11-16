export function publicCommentsUrl(apiBase, billId, location) {
  const state = typeof location?.state === "string" ? location.state.trim() : "";
  const district = location?.district;
  if (!state || !["string", "number"].includes(typeof district) ||
      !/^\d+$/.test(String(district).trim()) || !Number.isSafeInteger(Number(district))) {
    throw new Error("A valid state and district are required to view comments");
  }
  const query = new URLSearchParams({ state, district: String(Number(district)) });
  return `${apiBase}/comments/bills/${billId}/public?${query}`;
}
