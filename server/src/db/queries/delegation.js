import db from "../client.js";

// Both saved user locations and guest district lookups use this resolver.
// Keep roster rows intact so later feed queries can attach member details.
export async function findCurrentDelegation({ state, district } = {}, runner = db) {
  const normalizedState = typeof state === "string"
    ? state.trim().replace(/\s+/g, " ") : "";
  const districtText = String(district ?? "").trim();
  if (!normalizedState || !["string", "number"].includes(typeof district) ||
      !/^\d+$/.test(districtText) ||
      !Number.isSafeInteger(Number(districtText))) {
    const error = new Error("State and a non-negative integer district are required");
    error.code = "INVALID_DELEGATION_LOCATION";
    throw error;
  }
  const normalizedDistrict = Number(districtText);
  // One read keeps House/Senate resolution together; an absent House seat
  // must not short-circuit the Senate lookup. Read failures propagate.
  const { rows } = await runner.query(`SELECT * FROM reps
    WHERE LOWER(BTRIM(state)) = LOWER($1)
      AND is_current_member = true
      AND (chamber = 'Senate' OR
        (chamber = 'House of Representatives' AND congressionalDistrict = $2))
    ORDER BY bioguideid ASC`, [normalizedState, normalizedDistrict]);
  const houseMembers = rows.filter(member => member.chamber === "House of Representatives");
  if (houseMembers.length > 1) {
    throw new Error("Multiple current House members found for one district");
  }
  return {
    state: rows[0]?.state ?? normalizedState,
    district: normalizedDistrict,
    houseMember: houseMembers[0] ?? null,
    senators: rows.filter(member => member.chamber === "Senate"),
  };
}
