import { getVotePosition } from "./votePosition.js";

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

// Normalize identity only; grouped cards retain every individual vote link.
export function getCardResponseTargets(card) {
  const billId = card.bill?.id ?? card.bill_id;
  const members = Array.isArray(card.members) ? card.members : [{
    bioguideId: card.member_id,
    memberVoteId: card.member_vote_id,
    name: card.member_name,
    chamber: card.chamber,
  }];
  return members.map(member => ({
    billId,
    memberId: member.bioguideId,
    memberVoteId: member.memberVoteId,
    name: member.name,
    chamber: member.chamber,
  }));
}

export function buildMemberStancePayload(target, stance) {
  if (!Number.isSafeInteger(target?.billId) || target.billId <= 0 ||
      typeof target.memberId !== "string" || !target.memberId.trim() ||
      !Number.isSafeInteger(target.memberVoteId) || target.memberVoteId <= 0 ||
      !["approve", "disapprove"].includes(stance)) {
    throw new Error("A valid bill, member and recorded vote are required");
  }
  return {
    bill_id: target.billId,
    rep_bioguide_id: target.memberId,
    member_vote_id: target.memberVoteId,
    stance,
  };
}

export function getCardResponseState(card, interactions) {
  const answers = getCardResponseTargets(card).map(target => {
    const interaction = findVoteInteraction(interactions, target.billId, target.memberId, target.memberVoteId);
    const linked = isAnsweredVote(interaction, target.memberVoteId);
    const valid = ["approve", "disapprove"].includes(interaction?.stance);
    return { ...target, interaction, stance: linked && valid ? interaction.stance : null,
      invalid: linked && interaction.stance != null && !valid };
  });
  const answered = answers.filter(answer => answer.stance !== null);
  const unanimous = answers.length > 0 && answered.length === answers.length &&
    answers.every(answer => answer.stance === answers[0].stance);
  return {
    answers,
    stance: unanimous ? answers[0].stance : null,
    status: unanimous ? answers[0].stance : answered.length === 0 ? "neutral" :
      answered.length < answers.length ? "partial" : "mixed",
    invalid: answers.some(answer => answer.invalid),
  };
}

export function buildCardStanceRequest(card, interactions, stance) {
  if (!getVotePosition(card.position ?? card.vote).comparable) {
    throw new Error("This recorded position cannot be compared for alignment");
  }
  const targets = getCardResponseTargets(card);
  if (targets.length !== 2 || targets.some(target => target.chamber !== "Senate") ||
      targets[0].billId !== targets[1].billId ||
      targets[0].memberId === targets[1].memberId ||
      targets[0].memberVoteId === targets[1].memberVoteId) {
    throw new Error("A combined response requires two distinct Senators and vote links");
  }
  targets.forEach(target => buildMemberStancePayload(target, stance));
  return {
    bill_id: targets[0].billId,
    members: targets.map(target => ({ rep_bioguide_id: target.memberId, member_vote_id: target.memberVoteId })),
    stance: getCardResponseState(card, interactions).stance === stance ? null : stance,
  };
}

// Accept a complete confirmed batch only; never display a half-saved result.
export function reconcileCardStanceResult(interactions, request, saved) {
  if (!Array.isArray(saved) || saved.length !== request.members.length ||
      saved.some(row => !Number.isSafeInteger(row?.id) || row.id <= 0) ||
      new Set(saved.map(row => row.id)).size !== saved.length ||
      request.members.some(member => saved.filter(row =>
        row.bill_id === request.bill_id && row.rep_bioguide_id === member.rep_bioguide_id &&
        row.member_vote_id === member.member_vote_id && row.stance === request.stance).length !== 1)) {
    throw new Error("The server did not confirm both member responses. Refresh to check saved answers.");
  }
  return [...interactions.filter(row => !saved.some(updated => updated.id === row.id ||
    (updated.bill_id === row.bill_id && updated.rep_bioguide_id === row.rep_bioguide_id &&
      updated.member_vote_id === row.member_vote_id))), ...saved];
}
