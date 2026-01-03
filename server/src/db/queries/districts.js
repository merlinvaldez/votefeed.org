export async function getDistrictFromAddress(address) {
  const base = `http://localhost:${process.env.PORT || 4000}`;
  const districtUrl = new URL("districts", base);
  districtUrl.searchParams.set(`address`, address);

  const resp = await fetch(districtUrl);
  if (!resp.ok) throw new Error(`District lookup Query failed ${resp.status}`);
  const { state, congressionalDistrict } = await resp.json();
  return { state, district: congressionalDistrict };
}
