// Card-only contract; feed records keep their existing database field names.
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
