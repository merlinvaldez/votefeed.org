export function revealCandidateFocus(event) {
  const card = event.currentTarget;
  const roster = card.parentElement;
  if (!roster) return;

  const cardBounds = card.getBoundingClientRect();
  const rosterBounds = roster.getBoundingClientRect();
  const focusRoom = 6;
  const hiddenAtLeft = rosterBounds.left + focusRoom - cardBounds.left;
  const hiddenAtRight = cardBounds.right - (rosterBounds.right - focusRoom);

  if (hiddenAtLeft > 0) roster.scrollBy({ left: -hiddenAtLeft, behavior: "auto" });
  else if (hiddenAtRight > 0) roster.scrollBy({ left: hiddenAtRight, behavior: "auto" });
}
