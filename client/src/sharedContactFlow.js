export function sharedContactRequest(card, interactions) {
  const answers = card.members.map(member => interactions.find(answer =>
    answer.rep_bioguide_id === member.bioguideId && answer.member_vote_id === member.memberVoteId &&
    answer.bill_id === card.bill.id && ["approve", "disapprove"].includes(answer.stance)));
  if (card.members.length !== 2 || answers.some(answer => !Number.isSafeInteger(answer?.id)) ||
      new Set(answers.map(answer => answer.id)).size !== 2) {
    throw new Error("Respond for both Senators before preparing contact guides.");
  }
  return { interactionIds: answers.map(answer => answer.id) };
}

export function validateSharedContactDrafts(card, drafts) {
  if (!Array.isArray(drafts?.members) || drafts.members.length !== 2 ||
      card.members.some(member => drafts.members.filter(draft => draft.memberId === member.bioguideId &&
        typeof draft.callScript === "string" && draft.callScript.trim() &&
        typeof draft.messageTemplate === "string" && draft.messageTemplate.trim()).length !== 1)) {
    throw new Error("Contact guides for both Senators were not returned. Please retry.");
  }
  return drafts;
}
