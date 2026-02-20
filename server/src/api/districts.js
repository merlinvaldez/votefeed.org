import express from "express";
const router = express.Router();
export default router;

router.get("/", async (req, res) => {
  const { address } = req.query;
  const zipPattern = /\b\d{5}\b/;

  if (!address) {
    return res.status(400).json({ error: "address is required" });
  }
  if (!zipPattern.test(String(address).trim())) {
    return res.status(400).send("Enter a 5 digit ZIP code.");
  }

  try {
    const url = new URL(
      "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress",
    );
    url.searchParams.set("address", address);
    url.searchParams.set("benchmark", "Public_AR_Current");
    url.searchParams.set("vintage", "Current_Current");
    url.searchParams.set("format", "json");

    const response = await fetch(url.toString());
    if (!response.ok) {
      const body = await response.text();
      return res.status(502).json({
        error: "Geocoding service returned and error",
        status: response.status,
        details: body,
      });
    }
    const data = await response.json();

    const match = data?.result?.addressMatches?.[0];
    const state = match?.geographies?.["States"]?.[0]?.BASENAME;
    const district =
      match?.geographies?.["119th Congressional Districts"]?.[0]?.BASENAME;

    if (!match || !district) {
      return res.status(404).json({
        error: `We couldn’t match that address to a congressional district.
Please enter a U.S. address recognized by the 2020 Census. If it still doesn’t work, try removing the apartment/unit number or entering a nearby address.`,
      });
    }
    res.json({
      address: match.matchedAddress,
      state: state,
      congressionalDistrict: district,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch district information" });
  }
});
