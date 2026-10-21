const CENSUS_GEOCODER_URL =
  "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";
const CENSUS_BENCHMARK = "Public_AR_Current";

// Keep the geography layer aligned with the app's member and vote Congress.
// Update these together when the app advances to a new Congress.
const CENSUS_VINTAGE = "ACS2025_Current";
const SITTING_CONGRESSIONAL_DISTRICT_LAYER = "119th Congressional Districts";

export function buildCensusGeographyUrl(address) {
  const url = new URL(CENSUS_GEOCODER_URL);
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", CENSUS_BENCHMARK);
  url.searchParams.set("vintage", CENSUS_VINTAGE);
  url.searchParams.set("format", "json");
  return url;
}

function getDistrictFromGeography(geography) {
  const stateFips = String(geography?.STATE ?? "").trim();
  const geoid = String(geography?.GEOID ?? "").trim();
  if (!/^\d{2}$/.test(stateFips) || !/^\d{4}$/.test(geoid)) return null;
  if (!geoid.startsWith(stateFips)) return null;

  // GEOID is state FIPS plus district code; an at-large code of "00" becomes 0.
  const district = Number(geoid.slice(stateFips.length));
  return Number.isSafeInteger(district) && district >= 0 ? district : null;
}

export function extractDistrictFromCensusMatch(match) {
  const state = String(
    match?.geographies?.["States"]?.[0]?.BASENAME ?? "",
  ).trim();
  if (!state) return null;

  const geographies = match?.geographies ?? {};
  const layers = Object.keys(geographies)
    .filter((key) => /^\d+(?:st|nd|rd|th) Congressional Districts$/.test(key))
    .sort((a, b) => Number(b.match(/^\d+/)[0]) - Number(a.match(/^\d+/)[0]));
  const preferredLayers = layers.includes(
    SITTING_CONGRESSIONAL_DISTRICT_LAYER,
  )
    ? [
        SITTING_CONGRESSIONAL_DISTRICT_LAYER,
        ...layers.filter(
          (key) => key !== SITTING_CONGRESSIONAL_DISTRICT_LAYER,
        ),
      ]
    : layers;

  for (const layer of preferredLayers) {
    const districtGeography = geographies[layer]?.[0];
    let district = getDistrictFromGeography(districtGeography);

    // Keep accepting numeric BASENAME values if a Census layer omits GEOID.
    if (district === null) {
      const basename = String(districtGeography?.BASENAME ?? "").trim();
      const parsedBasename = /^\d+$/.test(basename) ? Number(basename) : null;
      if (Number.isSafeInteger(parsedBasename)) {
        district = parsedBasename;
      }
    }

    if (district !== null) return { state, district };
  }

  return null;
}
