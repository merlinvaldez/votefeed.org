import { ADDRESS_NOT_FOUND_MESSAGE } from "../db/queries/districts.js";
import {
  buildCensusGeographyUrl,
  extractDistrictFromCensusMatch,
} from "../utils/censusDistricts.js";
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
    const response = await fetch(buildCensusGeographyUrl(address));
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
    const districtData = extractDistrictFromCensusMatch(match);

    if (!match || districtData === null) {
      return res.status(404).json({ error: ADDRESS_NOT_FOUND_MESSAGE });
    }
    res.json({
      address: match.matchedAddress,
      state: districtData.state,
      congressionalDistrict: districtData.district,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch district information" });
  }
});
