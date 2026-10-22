// One request refreshes every chamber summary. Rep Card tabs select locally.
export async function fetchDelegationAlignment(authFetch, apiBase, policyArea = null) {
  const params = new URLSearchParams({ chamber: "All Reps" });
  if (policyArea) params.set("policyArea", policyArea);
  const response = await authFetch(`${apiBase}/users/me/alignment?${params}`);
  if (!response.ok) throw new Error("Failed to refresh alignment");
  return response.json();
}
