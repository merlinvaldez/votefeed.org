export function findVoteInteraction(interactions, billId, memberId, memberVoteId) {
  const matching = interactions.filter(interaction =>
    interaction.bill_id === billId && interaction.rep_bioguide_id === memberId,
  );
  const linked = matching.filter(interaction => memberVoteId != null && interaction.member_vote_id === memberVoteId);
  const candidates = linked.length ? linked : matching.filter(interaction => interaction.member_vote_id == null);
  return candidates.reduce((latest, interaction) =>
    !latest || interaction.id > latest.id ? interaction : latest, null);
}

export function isAnsweredVote(interaction, memberVoteId) {
  return memberVoteId != null && interaction?.member_vote_id === memberVoteId;
}

export function selectCardAlignment(alignment, chamber = "House") {
  if (!alignment) return null;
  return alignment.byChamber?.[chamber] ?? (alignment.selectedChamber === chamber ? alignment : null);
}
