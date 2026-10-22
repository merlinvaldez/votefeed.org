// Midnight after October 22 in America/New_York (EDT, UTC-04:00).
export const SENATE_NOTIFICATION_START_AT = "2026-10-23T04:00:00.000Z";
export const NOTIFICATION_START_AT = "2026-09-15T04:00:00.000Z";

export function isNotificationDateEligible(chamber: string, votedOn: string | null) {
  const cutoff = chamber.trim().toLowerCase() === "senate"
    ? SENATE_NOTIFICATION_START_AT
    : NOTIFICATION_START_AT;
  const timestamp = Date.parse(votedOn ?? "");
  return Number.isFinite(timestamp) && timestamp >= Date.parse(cutoff);
}

// Apply before pagination so historical Senate rows cannot crowd out new votes.
export const NOTIFICATION_DATE_FILTER =
  `and(chamber.eq.House,voted_on.gte.${NOTIFICATION_START_AT}),and(chamber.eq.Senate,voted_on.gte.${SENATE_NOTIFICATION_START_AT})`;
