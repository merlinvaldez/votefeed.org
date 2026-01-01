import express from "express";
const router = express.Router();
export default router;
import { getBillSummary } from "../db/queries/bills.js";

const apiKey = process.env.CONGRESS_API_KEY;

router.get("/", async (req, res) => {
  if (!apiKey) {
    return res.status(500).json({ error: "Missing Congress API Key" });
  }
  try {
    const fromDateTime = "2025-01-01T00:00:00Z";
    const baseUrl = new URL("https://api.congress.gov/v3/summaries/119/hr");
    baseUrl.searchParams.set("limit", "250");
    baseUrl.searchParams.set("fromDateTime", fromDateTime);
    baseUrl.searchParams.set("api_key", apiKey);
    console.log(baseUrl.toString());
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

router.get("/:billNumber", async (req, res) => {
  try {
    const billNumber = Number(req.params.billNumber);
    if (!Number.isInteger(billNumber)) {
      return res.status(400).json({ error: "Invalid bill number" });
    }
    const bill = await getBillSummary(billNumber);
    if (!bill || bill.length === 0)
      return res.status(404).json({ error: "Bill not found" });
    res.json(bill[0] || bill);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch bill" });
  }
});
