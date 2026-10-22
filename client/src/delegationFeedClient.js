export function buildFeedUrl({ apiBase, isGuest, district, pageSize, cursor = null, policyArea = null, chamber = "All Reps" }) {
  const params = new URLSearchParams({ limit: String(pageSize) });
  if (isGuest) {
    params.set("state", district.state);
    params.set("district", String(district.congressionalDistrict ?? district.district));
  }
  params.set("chamber", chamber);
  if (cursor) params.set("cursor", cursor);
  if (policyArea !== null) params.set("policyArea", policyArea);
  return `${apiBase}/${isGuest ? "reps" : "users/me"}/delegation/feed?${params}`;
}

// Retain canonical identities while supplying fields used by the current renderer.
// The dedicated card component replaces these display aliases in Step 5.
export function adaptDelegationFeed(feed) {
  const page = feed?.page;
  if (!Array.isArray(feed?.cards) || typeof page?.hasMore !== "boolean" ||
      !Number.isInteger(page.limit) || page.limit < 1 || page.limit > 50 ||
      feed.cards.length > page.limit ||
      typeof page.snapshotId !== "string" || !page.snapshotId.trim() ||
      (page.hasMore
        ? typeof page.nextCursor !== "string" || !page.nextCursor.trim()
        : page.nextCursor !== null)) {
    throw new Error("Invalid delegation feed response");
  }
  return { ...feed, rep: feed.delegation?.houseMember ?? null,
    votes: feed.cards.map(card => ({ ...card,
      bill_id: card.bill.id,
      legislation_type: card.bill.type,
      legislationnumber: card.bill.number,
      congress_number: card.event.congress,
      session_number: card.event.session,
      roll_call_number: card.event.rollCall,
      voted_on: card.votedOn,
      vote: card.position,
      officialSummary: card.summary.officialHtml,
      simplifiedText: card.summary.simplifiedText,
    })),
  };
}

export function mergeFeedPage(previous, next, cursor) {
  if (previous.page.snapshotId !== next.page.snapshotId || previous.page.nextCursor !== cursor ||
      previous.selectedPolicyArea !== next.selectedPolicyArea || previous.selectedChamber !== next.selectedChamber) return previous;
  const cards = [...new Map([...previous.cards, ...next.cards].map(card => [card.id, card])).values()];
  // Adapt only the incoming page (the combined list may exceed the page limit).
  const votes = [...new Map([...previous.votes, ...next.votes].map(card => [card.id, card])).values()];
  return { ...previous, ...next, cards, votes };
}

// A scope replacement aborts old reads. Tickets also guard promises whose
// transport ignores cancellation, including their catch/finally callbacks.
export function createFeedRequests() {
  let generation = 0;
  let active = null;
  return {
    reset() { generation += 1; active?.controller.abort(); active = null; },
    begin() {
      if (active) return null;
      const ticket = { generation, controller: new AbortController() };
      active = ticket;
      return ticket;
    },
    current(ticket) { return active === ticket && ticket.generation === generation; },
    finish(ticket) { if (active === ticket) active = null; },
  };
}
