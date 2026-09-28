import {
  buildCensusGeographyUrl,
  extractDistrictFromCensusMatch,
} from "../../utils/censusDistricts.js";

export const ADDRESS_NOT_FOUND_MESSAGE =
  "We couldn't match that address to a congressional district.\nPlease enter a U.S. address recognized by the 2020 Census. If it still doesn't work, try removing the apartment/unit number or entering a nearby address.";
export const ADDRESS_NOT_FOUND_CODE = "ADDRESS_NOT_FOUND";
export async function getDistrictFromAddress(address) {
  const resp = await fetch(buildCensusGeographyUrl(address));
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`District lookup failed ${resp.status}: ${body}`);
  }
  const data = await resp.json();
  const match = data?.result?.addressMatches?.[0];
  const districtData = extractDistrictFromCensusMatch(match);
  if (!match || districtData === null) {
    const err = new Error(ADDRESS_NOT_FOUND_MESSAGE);
    err.code = ADDRESS_NOT_FOUND_CODE;
    throw err;
  }
  return districtData;
}
