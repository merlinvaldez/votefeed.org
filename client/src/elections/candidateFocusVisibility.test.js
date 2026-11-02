import assert from "node:assert/strict";
import test from "node:test";
import { revealCandidateFocus } from "./candidateFocusVisibility.js";

function focusEvent({ rosterLeft, rosterRight, cardLeft, cardRight }) {
  const scrollCalls = [];
  const roster = {
    getBoundingClientRect: () => ({ left: rosterLeft, right: rosterRight }),
    scrollBy: (options) => scrollCalls.push(options),
  };
  const card = {
    parentElement: roster,
    getBoundingClientRect: () => ({ left: cardLeft, right: cardRight }),
  };
  return { event: { currentTarget: card }, scrollCalls };
}

test("keeps the focus ring inside the roster when a card is clipped at the right edge", () => {
  const { event, scrollCalls } = focusEvent({
    rosterLeft: 0,
    rosterRight: 300,
    cardLeft: 250,
    cardRight: 350,
  });

  revealCandidateFocus(event);

  assert.deepEqual(scrollCalls, [{ left: 56, behavior: "auto" }]);
});

test("scrolls back when a focused card is clipped at the left edge", () => {
  const { event, scrollCalls } = focusEvent({
    rosterLeft: 0,
    rosterRight: 300,
    cardLeft: -50,
    cardRight: 50,
  });

  revealCandidateFocus(event);

  assert.deepEqual(scrollCalls, [{ left: -56, behavior: "auto" }]);
});

test("does not move a card that already has room for its focus ring", () => {
  const { event, scrollCalls } = focusEvent({
    rosterLeft: 0,
    rosterRight: 300,
    cardLeft: 40,
    cardRight: 140,
  });

  revealCandidateFocus(event);

  assert.deepEqual(scrollCalls, []);
});
