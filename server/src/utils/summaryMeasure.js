const measures = { hr: "house-bill", s: "senate-bill", hres: "house-resolution",
  sres: "senate-resolution", hjres: "house-joint-resolution", sjres: "senate-joint-resolution",
  hconres: "house-concurrent-resolution", sconres: "senate-concurrent-resolution" };

export function matchesSummaryMeasure(bill, congress, type, number) {
  if (!Number.isSafeInteger(congress) || congress < 1 || !measures[type]) return false;
  try {
    const url = new URL(bill.legislation_url);
    return url.origin === "https://www.congress.gov" &&
      new RegExp(`^/bill/${congress}(st|nd|rd|th)-congress/${measures[type]}/${number}/?$`).test(url.pathname);
  } catch { return false; }
}
