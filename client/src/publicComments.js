import { memberLastName } from "./billDetailContext.js";

﻿export function publicCommentsUrl(apiBase, billId, location) {
  const state = typeof location?.state === "string" ? location.state.trim() : "";
  const district = location?.district;
  if (!state || !["string", "number"].includes(typeof district) ||
      !/^\d+$/.test(String(district).trim()) || !Number.isSafeInteger(Number(district))) {
    throw new Error("A valid state and district are required to view comments");
  }
  const query = new URLSearchParams({ state, district: String(Number(district)) });
  return `${apiBase}/comments/bills/${billId}/public?${query}`;
}

export function otherPublicComments(comments) {
  return comments.filter(comment => !comment.is_owned_by_viewer);
}

export function ownedCommentsForFolder(comments, folder, delegation) {
  if (folder.id === "All Reps") return comments;
  const memberIds = folder.id === "House"
    ? [delegation.houseMember?.bioguideid]
    : folder.id === "Senate"
      ? delegation.senators.map(member => member.bioguideid)
      : folder.cards.flatMap(card => card.members.map(member => member.bioguideId));
  return comments.filter(comment => memberIds.includes(comment.rep_bioguide_id));
}

export function commentRecipientLabel(comment, roster, cards = []) {
  const sharedCard = cards.find(card => card.event.chamber === "Senate" && card.members.length === 2 &&
    card.members.some(member => member.bioguideId === comment?.rep_bioguide_id &&
      member.memberVoteId === comment?.member_vote_id));
  if (sharedCard) {
    return sharedCard.members.map(member => `Sen. ${memberLastName(member.name)}`).join(" and ");
  }
  const recipient = roster.find(person => person.bioguideid === comment?.rep_bioguide_id);
  const name = comment?.recipient_name || recipient?.full_name;
  if (!name) return "";
  const chamber = comment?.recipient_chamber || recipient?.chamber || "";
  const title = chamber.toLowerCase().includes("senate") ? "Sen." : "Rep.";
  return `${title} ${memberLastName(name)}`;
}
