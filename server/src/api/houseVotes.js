import express from "express";
const router = express.Router();
export default router;

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
    for (let i = 0; i < 5; i++) {
      const vote = houseVotes[i];
      const congress = vote?.congress ?? 119;
      const session = vote.sessionNumber;
      const voteNumber = vote.rollCallNumber;

      const membersBaseUrl = new URL(
        `https://api.congress.gov/v3/house-vote/${congress}/${session}/${voteNumber}/members`
      );
      membersBaseUrl.searchParams.set("limit", "250");
      membersBaseUrl.searchParams.set("api_key", apiKey);
      let membersNext = membersBaseUrl.toString();
      let results = [];
      let failed = false;
      while (membersNext) {
        console.log(membersNext);
        const resp = await fetch(membersNext);
        if (!resp.ok) {
          const text = await resp.text();
          vote.votingRecord = null;
          vote.votingRecordError = `Congres API Error ${resp.status}: ${text}`;
          failed = true;
          break;
        }
        const data = await resp.json();
        const pageObj = data?.houseRollCallVoteMemberVotes || {};
        results = results.concat(pageObj.results || []);
        const paginationNext = data?.pagination?.next ?? null;
        if (paginationNext) {
          const next = new URL(paginationNext);
          next.searchParams.set("api_key", apiKey);
          membersNext = next.toString();
        } else {
          membersNext = null;
        }
      }
      if (!failed) vote.votingRecord = results;
    }
    return res.json({ count: houseVotes.length, houseVotes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch house votes" });
  }
});
