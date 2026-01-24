import express from "express";
const router = express.Router();
export default router;

import { findMemberVotes } from "../db/queries/houseVotes.js";

const apiKey = process.env.CONGRESS_API_KEY;

router.get("/", async (req, res) => {
  if (!apiKey) {
    return res.status(500).json({ error: "Missing Congress API Key" });
  }
  try {
    const baseUrl = new URL("https://api.congress.gov/v3/house-vote/119");
    baseUrl.searchParams.set("limit", "250");
    baseUrl.searchParams.set("api_key", apiKey);
    let houseVotes = [];
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
      houseVotes = houseVotes.concat(data?.houseRollCallVotes || []);
      const paginationNext = data?.pagination?.next ?? null;
      if (paginationNext) {
        const next = new URL(paginationNext);
        next.searchParams.set("api_key", apiKey);
        nextUrl = next.toString();
      } else {
        nextUrl = null;
      }
    }

    return res.json({ count: houseVotes.length, houseVotes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch house votes" });
  }
});

router.get("/member/:bioguideId", async (req, res) => {
  try {
    const rawLimit = req.query.limit;
    const rawOffset = req.query.offset;
    const parsedLimit = Number.parseInt(rawLimit, 10);
    const parsedOffset = Number.parseInt(rawOffset, 10);
    const limit =
      Number.isInteger(parsedLimit) && parsedLimit > 0
        ? parsedLimit
        : undefined;
    const offset =
      Number.isInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
    const votes = await findMemberVotes(req.params.bioguideId, {
      limit,
      offset,
    });
    res.json({ count: votes.length, votes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch member votes" });
  }
});

router.get("/:session/:voteNumber", async (req, res) => {
  if (!apiKey)
    return res.status(500).json({ error: "Missing Congress API Key" });
  const { session, voteNumber } = req.params;
  try {
    const baseUrl = new URL(
      `https://api.congress.gov/v3/house-vote/119/${session}/${voteNumber}/members`,
    );
    baseUrl.searchParams.set("limit", "250");
    baseUrl.searchParams.set("api_key", apiKey);
    let members = [];
    let nextUrl = baseUrl.toString();
    while (nextUrl) {
      const resp = await fetch(nextUrl);
      if (!resp.ok) {
        const text = await resp.text();
        return res.status(502).json({
          error: "Congress API Error",
          status: resp.status,
          details: text,
        });
      }
      const data = await resp.json();
      const pageObj = data?.houseRollCallVoteMemberVotes || {};
      members = members.concat(pageObj.results || []);
      const paginationNext = data?.pagination?.next ?? null;
      if (paginationNext) {
        const next = new URL(paginationNext);
        next.searchParams.set("api_key", apiKey);
        nextUrl = next.toString();
      } else {
        nextUrl = null;
      }
    }

    res.json({ count: members.length, members });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch member votes" });
  }
});
