import express from "express";
const router = express.Router();
export default router;
import "dotenv/config";

const apiKey = process.env.CONGRESS_API_KEY;

router.get("/", async (req, res) => {
  if (!apiKey) {
    return res.status(500).json({ error: "Missing Congress API Key" });
  }

  try {
    let members = [];
    let nextUrl = `https://api.congress.gov/v3/member?api_key=${encodeURIComponent(
      apiKey
    )}`;

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
      nextUrl = data?.pagination?.next ?? null;
    }

    res.json({ count: members.length, members });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch Members" });
  }
});
