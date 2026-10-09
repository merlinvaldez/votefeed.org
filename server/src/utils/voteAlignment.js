export function normalizeMemberPosition(position) {
  if (typeof position !== "string") return null;
  switch (position.trim().toLowerCase()) {
    case "yea":
    case "aye":
      return "support";
    case "nay":
    case "no":
      return "oppose";
    default:
      return null;
  }
}

function hasId(value) {
  return (Number.isSafeInteger(value) && value > 0) ||
    (typeof value === "string" && value.trim().length > 0);
}

function sameId(left, right) {
  return hasId(left) && hasId(right) && String(left) === String(right);
}

// bill_id on a vote must come from a verified measure join, not number alone.
export function compareStanceWithMemberVote(stance, memberVote) {
  if (!stance || !memberVote ||
      !sameId(stance.bill_id, memberVote.bill_id)) return null;

  const memberPosition = normalizeMemberPosition(memberVote.vote);
  if (!memberPosition) return null;

  let userPosition;
  switch (stance.stance) {
    case "support":
    case "oppose":
      userPosition = stance.stance;
      break;
    case "approve":
    case "disapprove":
      // Legacy agreement is meaningful only for the exact action answered.
      if (!sameId(stance.member_vote_id, memberVote.id) ||
          !sameId(stance.rep_bioguide_id, memberVote.member_id)) return null;
      userPosition = stance.stance === "approve"
        ? memberPosition
        : memberPosition === "support" ? "oppose" : "support";
      break;
    default:
      return null;
  }

  return {
    userPosition,
    memberPosition,
    agrees: userPosition === memberPosition,
  };
}
