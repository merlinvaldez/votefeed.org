//get an array summaries of all bills in the HR of congress 119

import express from "express";
const router = express.Router();
export default router;

const apiKey = process.env.CONGRESS_API_KEY;

router.get("/", async (req, res) => {
  if (!apiKey) {
    return res.status(500).json({ error: "Missing Congress API Key" });
  }

  try {
    const baseUrl = new URL("https://api.congress.gov/v3/summaries/119/hr");
    baseUrl.searchParams.set("limit", "250");
    baseUrl.searchParams.set("api_key", apiKey);
    let summaries = [];
    let nextUrl = baseUrl.toString();
    while (nextUrl) {
      console.log(nextUrl);
      const response = await fetch(nextUrl);
      if (!response.ok) {
        const text = await response.text();
        return res.status(502).json({
          error: "Congress API Error",
          status: response.status,
          details: text,
        });
      }
      const data = await response.json();
      summaries = summaries.concat(data?.summaries || []);
      const paginationNext = data?.pagination?.next ?? null;
      if (paginationNext) {
        const next = new URL(paginationNext);
        next.searchParams.set("api_key", apiKey);
        nextUrl = next.toString();
      } else {
        nextUrl = null;
      }
    }
    return res.json({ count: summaries.length, summaries });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch bill summaries" });
  }
});
