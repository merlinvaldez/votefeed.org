const measurePaths: Record<string, string> = {
  hr: "house-bill", s: "senate-bill",
  hres: "house-resolution", sres: "senate-resolution",
  hjres: "house-joint-resolution", sjres: "senate-joint-resolution",
  hconres: "house-concurrent-resolution", sconres: "senate-concurrent-resolution",
};

export function officialBillUrl(congress: number, type: string, number: number) {
  const path = measurePaths[type];
  if (!path || !Number.isSafeInteger(congress) || congress < 1 ||
      !Number.isSafeInteger(number) || number < 1) {
    throw new Error("Invalid official bill identity");
  }
  const lastTwo = congress % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? "th"
    : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[congress % 10] ?? "th";
  return `https://www.congress.gov/bill/${congress}${suffix}-congress/${path}/${number}`;
}
