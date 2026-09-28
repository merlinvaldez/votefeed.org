import express from "express";
const router = express.Router();
export default router;

import {
  findCurrentMembersByStateAndChamber,
  findRepByDistrict,
} from "../db/queries/reps.js";

const apiKey = process.env.CONGRESS_API_KEY;

router.get("/", async (req, res) => {
  if (!apiKey) {
    return res.status(500).json({ error: "Missing Congress API Key" });
  }

  try {
    const baseUrl = new URL("https://api.congress.gov/v3/member");
    baseUrl.searchParams.set("limit", "250");
    baseUrl.searchParams.set("currentMember", "true");
    baseUrl.searchParams.set("api_key", apiKey);
    baseUrl.searchParams.set("format", "json");
    let members = [];
    let nextUrl = baseUrl.toString();
    while (nextUrl) {
      const response = await fetch(nextUrl);
      if (!response.ok) {
        const text = await response.text();
        return res.status(502).json({
          error: "Congress API error",
          status: response.status,
          details: text,
        });
      }
      const data = await response.json();
      members = members.concat(data?.members || []);
      const paginationNext = data?.pagination?.next ?? null;

      if (paginationNext) {
        const next = new URL(paginationNext);
        next.searchParams.set("api_key", apiKey);
        next.searchParams.set("currentMember", "true");
        next.searchParams.set("format", "json");
        nextUrl = next.toString();
      } else {
        nextUrl = null;
      }
    }

    res.json({ count: members.length, members });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch Members" });
  }
});

router.get("/state/:state/senators", async (req, res) => {
  const state = String(req.params.state ?? "").trim().replace(/\s+/g, " ");
  if (!state) {
    return res.status(400).json({ error: "State name is required" });
  }

  try {
    const senators = await findCurrentMembersByStateAndChamber(
      state,
      "Senate",
    );
    return res.json({
      state: senators[0]?.state ?? state,
      chamber: "Senate",
      count: senators.length,
      senators,
    });
  } catch (err) {
    console.error("Failed to fetch senators by state", err);
    return res.status(500).json({ error: "Failed to fetch senators" });
  }
});

router.get("/district/:state/:districtId", async (req, res) => {
  const state = req.params.state;
  const district = Number(req.params.districtId);
  try {
    const rep = await findRepByDistrict(state, district);
    if (!rep)
      return res.status(404).json({ error: "No repfound for that district" });
    res.json(rep);
  } catch (err) {
    console.error("Failed to fectch rep by district", err);
    res.status(500).json({ error: "Failed to fetch representative" });
  }
});
