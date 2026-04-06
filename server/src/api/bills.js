import express from "express";
const router = express.Router();
export default router;
import {
  getBillSummary,
  getOrCreateAiBillSummary,
} from "../db/queries/bills.js";

const apiKey = process.env.CONGRESS_API_KEY;
const toCongressDateTimeString = (value) =>
  value.toISOString().replace(".000Z", "Z");

router.get("/", async (req, res) => {
  if (!apiKey) {
    return res.status(500).json({ error: "Missing Congress API Key" });
  }
  try {
    const billType = String(req.query.billType ?? "hr").trim().toLowerCase();
    const rawFromDateTime = String(
      req.query.fromDateTime ?? "2025-01-01T00:00:00Z",
    ).trim();
    const parsedFromDateTime = Date.parse(rawFromDateTime);
    if (!billType) {
      return res.status(400).json({ error: "Missing billType" });
    }
    if (!Number.isFinite(parsedFromDateTime)) {
      return res.status(400).json({ error: "Invalid fromDateTime" });
    }
    const baseUrl = new URL(
      `https://api.congress.gov/v3/summaries/119/${billType}`,
    );
    baseUrl.searchParams.set("limit", "250");
    baseUrl.searchParams.set(
      "fromDateTime",
      toCongressDateTimeString(new Date(parsedFromDateTime)),
    );
    baseUrl.searchParams.set("api_key", apiKey);
    baseUrl.searchParams.set("format", "json");
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
        next.searchParams.set("format", "json");
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

router.get("/:billType/:billNumber", async (req, res) => {
  try {
    const billType = String(req.params.billType || "").trim().toLowerCase();
    const billNumber = Number(req.params.billNumber);
    if (!billType) {
      return res.status(400).json({ error: "Invalid bill type" });
    }
    if (!Number.isInteger(billNumber)) {
      return res.status(400).json({ error: "Invalid bill number" });
    }
    const bill = await getBillSummary(billNumber, billType);
    if (!bill || bill.length === 0)
      return res.status(404).json({ error: "Bill not found" });
    res.json(bill[0] || bill);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch bill" });
  }
});

router.get("/:billType/:billNumber/ai-summary", async (req, res) => {
  try {
    const billType = String(req.params.billType || "").trim().toLowerCase();
    const billNumber = Number(req.params.billNumber);
    if (!billType) {
      return res.status(400).json({ error: "Invalid bill type" });
    }
    if (!Number.isInteger(billNumber)) {
      return res.status(400).json({ error: "Invalid bill number" });
    }
    const aiSummary = await getOrCreateAiBillSummary(billNumber, billType);
    if (!aiSummary) {
      return res.status(404).json({ error: "Bill not found" });
    }
    return res.json({ aiSummary });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to generate AI summary" });
  }
});
