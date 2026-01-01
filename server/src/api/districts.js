import express from "express";
const router = express.Router();
export default router;

router.get("/", async (req, res) => {
  const { address } = req.query;
  if (!address) {
    return res.status(400).json({ error: "address is required" });
  }

  try {
    const url = new URL(
      "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress"
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
      return res.status(404).json({ error: "No district found" });
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
