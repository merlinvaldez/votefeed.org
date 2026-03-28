import express from "express";
const router = express.Router();
export default router;

import {
  findMemberPolicyAreas,
  findMemberVotes,
} from "../db/queries/houseVotes.js";

const apiKey = process.env.CONGRESS_API_KEY;
const CONGRESS_API_ORIGIN = "https://api.congress.gov";

function toCongressNextUrl(paginationNext) {
  const next = new URL(paginationNext, CONGRESS_API_ORIGIN);
  next.searchParams.set("api_key", apiKey);
  return next.toString();
}

router.get("/", async (req, res) => {
  if (!apiKey) {
    return res.status(500).json({ error: "Missing Congress API Key" });
  }
  try {
    const rawFromDateTime = String(req.query.fromDateTime ?? "").trim();
    const parsedFromDateTime = rawFromDateTime
      ? Date.parse(rawFromDateTime)
      : null;
    if (rawFromDateTime && !Number.isFinite(parsedFromDateTime)) {
      return res.status(400).json({ error: "Invalid fromDateTime" });
    }
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
        nextUrl = toCongressNextUrl(paginationNext);
      } else {
        nextUrl = null;
      }
    }
    if (parsedFromDateTime !== null) {
      houseVotes = houseVotes.filter((vote) => {
        const voteStartDateMs = Date.parse(vote?.startDate ?? "");
        return (
          Number.isFinite(voteStartDateMs) &&
          voteStartDateMs >= parsedFromDateTime
        );
      });
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
    const policyArea = String(req.query.policyArea ?? "").trim() || null;
    const limit =
      Number.isInteger(parsedLimit) && parsedLimit > 0
        ? parsedLimit
        : undefined;
    const offset =
      Number.isInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
    const [votes, policyAreaSummary] = await Promise.all([
      findMemberVotes(req.params.bioguideId, {
        limit,
        offset,
        policyArea,
      }),
      findMemberPolicyAreas(req.params.bioguideId),
    ]);
    res.json({
      count: votes.length,
      votes,
      policyAreas: policyAreaSummary.items,
      totalPolicyCount: policyAreaSummary.totalCount,
      selectedPolicyArea: policyArea,
    });
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
        nextUrl = toCongressNextUrl(paginationNext);
      } else {
        nextUrl = null;
      }
    }

    res.json({ count: members.length, members });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Failed to fetch member votes",
      details: err?.message || "Unknown upstream error",
    });
  }
});
