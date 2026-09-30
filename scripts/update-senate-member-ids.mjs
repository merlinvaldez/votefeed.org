import { writeFile } from "node:fs/promises";

const congress = 119;
const firstDay = "2025-01-03";
const lastDay = "2027-01-03";
const source = "https://unitedstates.github.io/congress-legislators";
const crosswalk = new Map();

for (const category of ["current", "historical"]) {
  const response = await fetch(`${source}/legislators-${category}.json`);
  if (!response.ok) throw new Error(`Legislator source returned ${response.status}`);
  for (const legislator of await response.json()) {
    const { lis, bioguide } = legislator.id ?? {};
    if (!lis || !bioguide) continue;
    if (!legislator.terms?.some((term) =>
      term.type === "sen" && term.start < lastDay &&
      (!term.end || term.end >= firstDay)
    )) continue;
    const previous = crosswalk.get(lis);
    if (previous && previous !== bioguide) {
      throw new Error(`Conflicting Bioguide IDs for LIS ${lis}`);
    }
    crosswalk.set(lis, bioguide);
  }
}

const members = Object.fromEntries([...crosswalk].sort(([a], [b]) => a.localeCompare(b)));
await writeFile(
  new URL("../supabase/functions/sync-senate-votes/member-ids-119.json", import.meta.url),
  `${JSON.stringify({ congress, source, members }, null, 2)}\n`,
);
console.log(`Wrote ${crosswalk.size} Senate LIS to Bioguide mappings`);
