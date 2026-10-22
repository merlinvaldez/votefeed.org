// Card-only contract; feed records keep their existing database field names.
export function availableCardChambers({ houseMember, senators, houseLoading, delegationLoading, delegationError }) {
  const chambers = [
    ...(houseMember || houseLoading ? ["House"] : []),
    ...(senators.length || delegationLoading || delegationError ? ["Senate"] : []),
  ];
  return chambers.length === 2 ? ["All Reps", ...chambers] : chambers;
}

export function selectAvailableCardChamber(available, requested) {
  return available.includes(requested) ? requested : available[0] ?? "All Reps";
}

export function toCardMember(member) {
  if (!member) return null;
  const chamber = member.chamber === "Senate" ? "Senate" : "House";
  return {
    bioguideId: member.bioguideid ?? null,
    chamber,
    name: member.full_name ?? "",
    party: member.party ?? null,
    state: member.state ?? null,
    district: chamber === "House" ? (member.congressionaldistrict ?? null) : null,
    portrait: member.image_url ?? null,
    officialWebsite: member.official_website_url ?? null,
  };
}

export function toCardDelegation(houseMember, senators = []) {
  return {
    houseMember: toCardMember(houseMember),
    senators: senators.map(toCardMember),
  };
}
