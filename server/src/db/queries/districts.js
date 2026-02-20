export async function getDistrictFromAddress(address) {
  const url = new URL(
    "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress",
  );
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("vintage", "Current_Current");
  url.searchParams.set("format", "json");
  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`District lookup failed ${resp.status}: ${body}`);
  }
  const data = await resp.json();
  const match = data?.result?.addressMatches?.[0];
  const state = match?.geographies?.["States"]?.[0]?.BASENAME;
  const district =
    match?.geographies?.["119th Congressional Districts"]?.[0]?.BASENAME;
  if (!match || !state || !district) {
    throw new Error(
      `We couldn’t match that address to a congressional district.
Please enter a U.S. address recognized by the 2020 Census. If it still doesn’t work, try removing the apartment/unit number or entering a nearby address.`,
    );
  }
  return { state, district };
}
