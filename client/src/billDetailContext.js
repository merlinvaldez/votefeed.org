export const memberLastName = (name = "") => name.includes(",")
  ? name.split(",")[0].trim() : name.trim().split(/\s+/).at(-1) || "";

export function billFolderTabs(detail) {
  const house = detail.cards.filter(card => card.event.chamber === "House");
  const senate = detail.cards.filter(card => card.event.chamber === "Senate");
  const tabs = [{ id: "All Reps", label: "All Reps", cards: detail.cards }];
  if (detail.delegation.houseMember) tabs.push({ id: "House", label: "House", cards: house });
  if (detail.delegation.senators.length) {
    if (senate.length > 1) {
      for (const card of senate) for (const member of card.members) {
        const surname = memberLastName(member.name);
        const duplicateName = senate.flatMap(item => item.members).filter(item => memberLastName(item.name) === surname).length > 1;
        tabs.push({ id: member.bioguideId, label: duplicateName ? member.name : surname,
          cards: [{ ...card, members: [member] }] });
      }
    } else tabs.push({ id: "Senate", label: "Senate", cards: senate });
  }
  return tabs;
}

export function initialBillFolder(tabs, { chamber = "All Reps", cardId = null } = {}) {
  const exact = tabs.find(tab => tab.id !== "All Reps" && tab.cards.some(card => card.id === cardId));
  if (chamber === "Senate") return exact?.id ?? tabs.find(tab => tab.id === "Senate")?.id ?? "All Reps";
  return tabs.some(tab => tab.id === chamber) ? chamber : "All Reps";
}

export function billDetailUrl({ apiBase, authenticated, billType, billNumber, congress, location, cardId }) {
  const query = new URLSearchParams({ congress: String(congress) });
  if (!authenticated) {
    query.set("state", location.state);
    query.set("district", String(location.congressionalDistrict ?? location.district));
  }
  if (cardId) query.set("cardId", cardId);
  return `${apiBase}/${authenticated ? "users/me" : "reps"}/delegation/bills/${billType}/${billNumber}?${query}`;
}

export function billNavigation(card, chamber, location) {
  const query = new URLSearchParams({ congress: String(card.bill.congress), chamber, cardId: card.id });
  if (location?.state) {
    query.set("state", location.state);
    query.set("district", String(location.congressionalDistrict ?? location.district));
  }
  return `/bill/${card.bill.type}/${card.bill.number}?${query}`;
}

export function panelBill(detail, card, member) {
  return { ...detail.bill, bill_id: detail.bill.id,
    congress_number: card?.event.congress ?? Number(detail.bill.legislation_url?.match(/bill\/(\d+)/)?.[1]),
    legislation_type: detail.bill.bill_type, legislationnumber: detail.bill.number,
    vote: card?.position ?? null, voted_on: card?.votedOn ?? null,
    member_vote_id: member?.memberVoteId ?? null,
    vote_result: card?.result?.result ?? null,
    vote_yes_count: card?.result?.yes_count ?? null, vote_no_count: card?.result?.no_count ?? null };
}
