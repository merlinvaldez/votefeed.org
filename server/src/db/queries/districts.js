export const ADDRESS_NOT_FOUND_MESSAGE =
  "We couldn't match that address to a congressional district.\nPlease enter a U.S. address recognized by the 2020 Census. If it still doesn't work, try removing the apartment/unit number or entering a nearby address.";
export const ADDRESS_NOT_FOUND_CODE = "ADDRESS_NOT_FOUND";

// Census changes the geography label as new congressional maps are published.
// Prefer the sitting Congress while it is present, then use the newest available
// congressional district layer instead of treating a valid address as unmatched.
export function getCongressionalDistrict(geographies) {
  const layers = Object.keys(geographies || {})
    .filter((key) => /^\d+(?:st|nd|rd|th) Congressional Districts$/.test(key))
    .sort((a, b) => Number(b.match(/^\d+/)[0]) - Number(a.match(/^\d+/)[0]));
  const preferred = layers.includes("119th Congressional Districts")
    ? ["119th Congressional Districts", ...layers.filter((key) => key !== "119th Congressional Districts")]
    : layers;
  for (const layer of preferred) {
    const district = geographies[layer]?.[0]?.BASENAME;
    if (district) return district;
  }
  return null;
}

export async function getDistrictFromAddress(address) {
  const url = new URL(
    "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress",
  );
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("vintage", "ACS2025_Current");
  url.searchParams.set("format", "json");
  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`District lookup failed ${resp.status}: ${body}`);
  }
  const data = await resp.json();
  const match = data?.result?.addressMatches?.[0];
  const state = match?.geographies?.["States"]?.[0]?.BASENAME;
  const district = getCongressionalDistrict(match?.geographies);
  if (!match || !state || !district) {
    const err = new Error(ADDRESS_NOT_FOUND_MESSAGE);
    err.code = ADDRESS_NOT_FOUND_CODE;
    throw err;
  }
  return { state, district };
}
